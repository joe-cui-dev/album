import type { PhotoCollection, ViewerBootstrapResponse } from "@album/shared";
import { AlbumTransportError, type AlbumTransportErrorCode } from "../../lib/albumTransport.js";
import type { PhotoViewerPort } from "./photoViewerPort.js";

export interface SequencePosition {
  /** Zero-based position from the newest Photo in the originating Browsing Window. */
  index: number;
  /** Only present once the originating window is exhausted. */
  total?: number;
}

export interface PhotoViewerSnapshot {
  photoId: string;
  isLoading: boolean;
  bootstrap?: ViewerBootstrapResponse;
  loadError?: AlbumTransportErrorCode;
  /** ADR-0061: the requested source collection no longer contains the Photo; the client must offer an explicit switch or return rather than silently changing the Sequence. */
  collectionChanged?: { currentCollection: PhotoCollection };
  /** A non-estimated "n of total"; absent whenever reliability isn't established for the current Photo. */
  sequencePosition?: SequencePosition;
}

export interface PhotoViewerIntents {
  /** Toward `newerPhotoId` in visual collection order. */
  showPrevious(): void;
  /** Toward `olderPhotoId` in visual collection order. */
  showNext(): void;
  retry(): void;
  /** Reloads the current bootstrap after a chronology mutation so neighbours and exact position converge. */
  refresh(): void;
  /** Explicit acknowledgement of a `photo_collection_changed` conflict. */
  switchToCurrentCollection(): void;
  /** The adapter calls this once the current Display Photo has decoded, permitting bounded neighbour prefetch. */
  notifyDisplayDecoded(): void;
}

export interface PhotoViewer {
  getSnapshot(): PhotoViewerSnapshot;
  subscribe(listener: () => void): () => void;
  /** The Photo's currently resolved collection, once known; lets the route layer decide a Close destination without reaching into `getSnapshot().bootstrap`. */
  getCurrentCollection(): PhotoCollection | undefined;
  intents: PhotoViewerIntents;
  dispose(): void;
}

export interface PhotoViewerOptions {
  photoId: string;
  /** Present only for a contextual open from Timeline or Archive; a direct route infers the current collection. */
  sourceCollection?: PhotoCollection;
  port: PhotoViewerPort;
  /**
   * The exact Viewer Sequence Position calculated by the originating Browsing
   * Window at the moment this Photo was opened; absent for a direct route.
   * PhotoViewer never re-queries the Browsing Window afterward (ADR-0056) --
   * each Previous/Next step only offsets this fixed value, and a collection
   * switch clears it because the original Sequence no longer applies.
   */
  initialSequencePosition?: SequencePosition;
}

interface NetworkConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** ADR-0056: one independent deep module per opened Photo Viewer. */
export const createPhotoViewer = (options: PhotoViewerOptions): PhotoViewer => {
  const { port } = options;

  let disposed = false;
  let currentPhotoId = options.photoId;
  let requestedCollection = options.sourceCollection;
  const listeners = new Set<() => void>();

  let isLoading = false;
  let bootstrap: ViewerBootstrapResponse | undefined;
  let loadError: AlbumTransportErrorCode | undefined;
  let collectionChanged: { currentCollection: PhotoCollection } | undefined;
  let sequencePosition: SequencePosition | undefined = options.initialSequencePosition;
  let currentAbortController: AbortController | undefined;
  const prefetchAbortControllers = new Set<AbortController>();
  const prefetchedPhotoIds = new Set<string>();
  let cachedSnapshot: PhotoViewerSnapshot | undefined;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const runLoad = async (
    photoId: string,
    collection: PhotoCollection | undefined,
    sequenceDelta = 0,
  ): Promise<void> => {
    currentAbortController?.abort();
    const controller = new AbortController();
    currentAbortController = controller;
    isLoading = true;
    loadError = undefined;
    collectionChanged = undefined;
    cachedSnapshot = undefined;
    notify();

    try {
      const response = await port.loadViewerBootstrap({
        photoId,
        ...(collection !== undefined ? { collection } : {}),
        signal: controller.signal,
      });
      if (disposed || controller.signal.aborted) {
        return;
      }
      currentPhotoId = photoId;
      requestedCollection = response.collection;
      bootstrap = response;
      if (sequenceDelta !== 0 && sequencePosition) {
        sequencePosition = { index: sequencePosition.index + sequenceDelta, ...(sequencePosition.total !== undefined ? { total: sequencePosition.total } : {}) };
      }
    } catch (error) {
      if (disposed || controller.signal.aborted) {
        return;
      }
      if (error instanceof AlbumTransportError && error.code === "photo_collection_changed" && error.currentCollection) {
        collectionChanged = { currentCollection: error.currentCollection };
      } else {
        loadError = error instanceof AlbumTransportError ? error.code : "unexpected";
      }
    } finally {
      if (!disposed) {
        isLoading = false;
        cachedSnapshot = undefined;
        notify();
      }
    }
  };

  const shouldSuppressPrefetch = (): boolean => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return true;
    }
    const connection = (navigator as unknown as { connection?: NetworkConnectionLike }).connection;
    if (connection?.saveData) {
      return true;
    }
    if (connection?.effectiveType !== undefined && ["slow-2g", "2g"].includes(connection.effectiveType)) {
      return true;
    }
    return false;
  };

  const prefetchImage = (url: string): void => {
    if (typeof Image === "undefined") {
      return;
    }
    const image = new Image();
    image.src = url;
  };

  const prefetchNeighbours = async (): Promise<void> => {
    if (disposed || !bootstrap || shouldSuppressPrefetch()) {
      return;
    }
    const openedForPhotoId = currentPhotoId;
    const targets = [bootstrap.newerPhotoId, bootstrap.olderPhotoId].filter(
      (id): id is string => id !== undefined && !prefetchedPhotoIds.has(id),
    );
    await Promise.all(
      targets.map(async (photoId) => {
        prefetchedPhotoIds.add(photoId);
        const controller = new AbortController();
        prefetchAbortControllers.add(controller);
        try {
          const response = await port.loadViewerBootstrap({
            photoId,
            ...(requestedCollection !== undefined ? { collection: requestedCollection } : {}),
            signal: controller.signal,
          });
          // A stale navigation makes this prefetch irrelevant; never surface its result.
          if (disposed || currentPhotoId !== openedForPhotoId) {
            return;
          }
          prefetchImage(response.displayAccess.url);
        } catch {
          // Best-effort: a failed prefetch leaves the neighbour to load normally on demand.
        } finally {
          prefetchAbortControllers.delete(controller);
        }
      }),
    );
  };

  void runLoad(currentPhotoId, requestedCollection);

  const getSnapshot = (): PhotoViewerSnapshot => {
    if (!cachedSnapshot) {
      cachedSnapshot = {
        photoId: currentPhotoId,
        isLoading,
        ...(bootstrap ? { bootstrap } : {}),
        ...(loadError ? { loadError } : {}),
        ...(collectionChanged ? { collectionChanged } : {}),
        ...(sequencePosition ? { sequencePosition } : {}),
      };
    }
    return cachedSnapshot;
  };

  const intents: PhotoViewerIntents = {
    showPrevious: () => {
      if (isLoading || bootstrap?.newerPhotoId === undefined) {
        return;
      }
      void runLoad(bootstrap.newerPhotoId, requestedCollection, -1);
    },
    showNext: () => {
      if (isLoading || bootstrap?.olderPhotoId === undefined) {
        return;
      }
      void runLoad(bootstrap.olderPhotoId, requestedCollection, 1);
    },
    retry: () => {
      if (loadError === undefined) {
        return;
      }
      void runLoad(currentPhotoId, requestedCollection);
    },
    refresh: () => {
      // A chronology mutation can move this Photo anywhere in the source
      // Browsing Window. The old index is no longer exact, so omit it rather
      // than announcing a stale position until a future window establishes one.
      sequencePosition = undefined;
      void runLoad(currentPhotoId, requestedCollection);
    },
    switchToCurrentCollection: () => {
      if (!collectionChanged) {
        return;
      }
      // The Sequence no longer applies once the requested collection changes underneath it.
      sequencePosition = undefined;
      void runLoad(currentPhotoId, collectionChanged.currentCollection);
    },
    notifyDisplayDecoded: () => {
      void prefetchNeighbours();
    },
  };

  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCurrentCollection: () => bootstrap?.collection,
    intents,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      currentAbortController?.abort();
      for (const controller of prefetchAbortControllers) {
        controller.abort();
      }
      prefetchAbortControllers.clear();
      listeners.clear();
    },
  };
};
