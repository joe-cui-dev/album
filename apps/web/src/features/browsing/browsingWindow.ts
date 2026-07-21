import { getCapturedAtComponents, type CapturedAt, type PhotoCollection, type TimelinePhotoV2 } from "@album/shared";
import { AlbumTransportError, type AlbumTransportErrorCode } from "../../lib/albumTransport.js";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";
import { computeJustifiedRows, type JustifiedLayoutItem, type JustifiedRowsOptions } from "./justifiedRows.js";

export interface PhotoDescriptor {
  photoId: string;
  fileName: string;
  capturedAt: CapturedAt;
  addedAt: string;
  displayDimensions: { width: number; height: number };
  timelineThumbnailSources: TimelinePhotoV2["timelineThumbnailSources"];
  aspectRatio: number;
  periodKey: string;
}

export type RestorationAnchor =
  | { kind: "photo"; photoId: string; rowOffset: number }
  | { kind: "period"; periodKey: string };

export interface BrowsingWindowSnapshot {
  collection: PhotoCollection;
  layoutItems: JustifiedLayoutItem[];
  /** The last loaded period's withheld tail; see `computeJustifiedRows`. */
  incompleteTailPhotoIds?: string[];
  descriptorsById: ReadonlyMap<string, PhotoDescriptor>;
  /** Photo ids withheld by a membership change; still present in `descriptorsById` and laid out, but not renderable (ADR-0067). */
  withheldPhotoIds: ReadonlySet<string>;
  photoCount: number;
  isLoadingInitial: boolean;
  isLoadingMore: boolean;
  isExhausted: boolean;
  loadError?: AlbumTransportErrorCode;
  restorationAnchor?: RestorationAnchor;
}

export type LayoutOptions = Omit<JustifiedRowsOptions, "hasMore">;

export interface BrowsingWindowIntents {
  /** Requests the next older page; a no-op while a load is in flight, the collection is exhausted, or the last load failed. */
  loadMore(): void;
  /** Retries the load that produced the current `loadError`; a no-op otherwise. */
  retry(): void;
  setLayout(options: LayoutOptions): void;
  recordRestorationAnchor(anchor: RestorationAnchor | undefined): void;
  /** Coalesced renewal demand: renews only the ids nearing expiry, batched under the port's limit. */
  requestThumbnailAccess(photoIds: string[]): void;
  /**
   * Marks a loaded descriptor as not present in this window's collection without
   * removing it, so a matching `false` call restores the identical index and no
   * displayed row changes geometry (ADR-0067).
   */
  setWithheld(photoId: string, withheld: boolean): void;
}

export interface SequencePosition {
  /** Zero-based position from the newest loaded Photo. */
  index: number;
  /** Only present once the window has loaded the whole collection (`isExhausted`); an in-progress window can't yet say how many Photos remain older. */
  total?: number;
}

export interface BrowsingWindow {
  getSnapshot(): BrowsingWindowSnapshot;
  subscribe(listener: () => void): () => void;
  /** The originating Viewer Sequence Position for a loaded Photo, or `undefined` while its position isn't yet observed. */
  getSequencePosition(photoId: string): SequencePosition | undefined;
  intents: BrowsingWindowIntents;
  dispose(): void;
}

export interface BrowsingWindowOptions {
  collection: PhotoCollection;
  /** A navigation anchor ("YYYY-MM" or "YYYY-unknown") for the initial load; absent starts at the latest Photo. */
  startAt?: string;
  port: AlbumBrowsingPort;
  layout: LayoutOptions;
  /**
   * A page already fetched for this exact `collection`/`startAt` (ADR-0058's
   * date-Jump probe). When present, it seeds the window directly instead of
   * issuing a second, redundant initial load for the same anchor.
   */
  initialPage?: { photos: TimelinePhotoV2[]; nextCursor?: string; expiresAt?: string };
}

const RENEWAL_LEAD_MS = 60_000;
const MAX_RENEWAL_BATCH = 100;

/** ADR-0055: one deep module per history entry's Browsing Window; see `docs/browsing-tracer-implementation.md`. */
export const createBrowsingWindow = (options: BrowsingWindowOptions): BrowsingWindow => {
  const { collection, startAt, port } = options;

  let disposed = false;
  let layoutOptions = options.layout;
  const listeners = new Set<() => void>();

  const descriptorsById = new Map<string, PhotoDescriptor>();
  const descriptorOrder: string[] = [];
  const withheldPhotoIds = new Set<string>();
  const sequenceIndexByPhotoId = new Map<string, number>();
  const leaseExpiresAtMsByPhotoId = new Map<string, number>();
  const renewalInFlight = new Set<string>();
  const renewalAbortControllers = new Set<AbortController>();

  let nextCursor: string | undefined;
  let isExhausted = false;
  let isLoadingInitial = false;
  let isLoadingMore = false;
  let loadError: AlbumTransportErrorCode | undefined;
  let lastLoadKind: "initial" | "more" = "initial";
  let currentAbortController: AbortController | undefined;
  let restorationAnchor: RestorationAnchor | undefined;

  let dirty = true;
  let cachedLayoutItems: JustifiedLayoutItem[] = [];
  let cachedIncompleteTail: string[] | undefined;
  let cachedSnapshot: BrowsingWindowSnapshot | undefined;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const markDirty = (): void => {
    dirty = true;
  };

  const periodKeyOf = (capturedAt: CapturedAt): string => {
    const { year, month } = getCapturedAtComponents(capturedAt);
    const paddedYear = String(year).padStart(4, "0");
    return month !== undefined ? `${paddedYear}-${String(month).padStart(2, "0")}` : `${paddedYear}-unknown`;
  };

  const toDescriptor = (photo: TimelinePhotoV2): PhotoDescriptor => ({
    photoId: photo.photoId,
    fileName: photo.fileName,
    capturedAt: photo.capturedAt,
    addedAt: photo.addedAt,
    displayDimensions: photo.displayDimensions,
    timelineThumbnailSources: photo.timelineThumbnailSources,
    aspectRatio: photo.displayDimensions.width / photo.displayDimensions.height,
    periodKey: periodKeyOf(photo.capturedAt),
  });

  const applyPage = (page: {
    photos: TimelinePhotoV2[];
    nextCursor?: string;
    expiresAt?: string;
  }): void => {
    const leaseExpiresAtMs = page.expiresAt !== undefined ? Date.parse(page.expiresAt) : undefined;
    for (const photo of page.photos) {
      // First-seen descriptor and position win; a later duplicate cursor result is ignored (ADR-0055).
      if (!descriptorsById.has(photo.photoId)) {
        descriptorsById.set(photo.photoId, toDescriptor(photo));
        sequenceIndexByPhotoId.set(photo.photoId, descriptorOrder.length);
        descriptorOrder.push(photo.photoId);
      }
      if (leaseExpiresAtMs !== undefined) {
        leaseExpiresAtMsByPhotoId.set(photo.photoId, leaseExpiresAtMs);
      }
    }
    nextCursor = page.nextCursor;
    isExhausted = page.nextCursor === undefined;
    markDirty();
  };

  const classifyError = (error: unknown): AlbumTransportErrorCode =>
    error instanceof AlbumTransportError ? error.code : "unexpected";

  const runLoad = async (kind: "initial" | "more"): Promise<void> => {
    if (disposed || currentAbortController !== undefined) {
      return;
    }
    const controller = new AbortController();
    currentAbortController = controller;
    lastLoadKind = kind;
    if (kind === "initial") {
      isLoadingInitial = true;
    } else {
      isLoadingMore = true;
    }
    loadError = undefined;
    markDirty();
    notify();

    try {
      const page = await port.loadCollectionPage({
        collection,
        ...(kind === "initial" && startAt !== undefined ? { startAt } : {}),
        ...(kind === "more" && nextCursor !== undefined ? { cursor: nextCursor } : {}),
        signal: controller.signal,
      });
      if (disposed) {
        return;
      }
      applyPage(page);
    } catch (error) {
      if (disposed) {
        return;
      }
      loadError = classifyError(error);
      markDirty();
    } finally {
      if (!disposed) {
        isLoadingInitial = false;
        isLoadingMore = false;
        currentAbortController = undefined;
        markDirty();
        notify();
      }
    }
  };

  const renewThumbnailAccess = async (photoIds: string[]): Promise<void> => {
    if (disposed) {
      return;
    }
    const now = Date.now();
    const due = photoIds
      .filter((photoId) => descriptorsById.has(photoId) && !renewalInFlight.has(photoId))
      .filter((photoId) => {
        const expiresAtMs = leaseExpiresAtMsByPhotoId.get(photoId);
        return expiresAtMs === undefined || expiresAtMs - now <= RENEWAL_LEAD_MS;
      })
      .slice(0, MAX_RENEWAL_BATCH);
    if (due.length === 0) {
      return;
    }
    for (const photoId of due) {
      renewalInFlight.add(photoId);
    }
    const controller = new AbortController();
    renewalAbortControllers.add(controller);
    try {
      const response = await port.renewThumbnailAccess({ photoIds: due, signal: controller.signal });
      if (disposed) {
        return;
      }
      const expiresAtMs = Date.parse(response.expiresAt);
      for (const renewed of response.photos) {
        const descriptor = descriptorsById.get(renewed.photoId);
        if (!descriptor) {
          continue;
        }
        descriptorsById.set(renewed.photoId, {
          ...descriptor,
          timelineThumbnailSources: renewed.timelineThumbnailSources,
        });
        leaseExpiresAtMsByPhotoId.set(renewed.photoId, expiresAtMs);
      }
      markDirty();
      notify();
    } catch {
      // A failed renewal leaves the existing (possibly expiring) sources in place; the next demand call retries.
    } finally {
      renewalAbortControllers.delete(controller);
      for (const photoId of due) {
        renewalInFlight.delete(photoId);
      }
    }
  };

  const rebuildLayoutIfDirty = (): void => {
    if (!dirty) {
      return;
    }
    // A withheld descriptor stays in the layout input so its row/period never changes shape
    // or count (ADR-0067); only the rendering layer skips drawing it, using `withheldPhotoIds`.
    const layoutDescriptors = descriptorOrder.map((photoId) => {
      const descriptor = descriptorsById.get(photoId)!;
      return { photoId: descriptor.photoId, aspectRatio: descriptor.aspectRatio, periodKey: descriptor.periodKey };
    });
    const { items, incompleteTailPhotoIds } = computeJustifiedRows(layoutDescriptors, {
      ...layoutOptions,
      // A failed load also relaxes the withheld tail into view (implementation doc "Justified Rows and Virtualisation").
      hasMore: !isExhausted && loadError === undefined,
    });
    cachedLayoutItems = items;
    cachedIncompleteTail = incompleteTailPhotoIds;
    cachedSnapshot = undefined;
    dirty = false;
  };

  const getSnapshot = (): BrowsingWindowSnapshot => {
    rebuildLayoutIfDirty();
    if (!cachedSnapshot) {
      cachedSnapshot = {
        collection,
        layoutItems: cachedLayoutItems,
        ...(cachedIncompleteTail ? { incompleteTailPhotoIds: cachedIncompleteTail } : {}),
        descriptorsById,
        withheldPhotoIds,
        photoCount: descriptorOrder.length,
        isLoadingInitial,
        isLoadingMore,
        isExhausted,
        ...(loadError ? { loadError } : {}),
        ...(restorationAnchor ? { restorationAnchor } : {}),
      };
    }
    return cachedSnapshot;
  };

  const intents: BrowsingWindowIntents = {
    loadMore: () => {
      if (isExhausted || loadError !== undefined) {
        return;
      }
      void runLoad("more");
    },
    retry: () => {
      if (loadError === undefined) {
        return;
      }
      void runLoad(lastLoadKind);
    },
    setLayout: (next) => {
      layoutOptions = next;
      markDirty();
      cachedSnapshot = undefined;
      notify();
    },
    recordRestorationAnchor: (anchor) => {
      restorationAnchor = anchor;
      cachedSnapshot = undefined;
      notify();
    },
    requestThumbnailAccess: (photoIds) => {
      void renewThumbnailAccess(photoIds);
    },
    setWithheld: (photoId, withheld) => {
      if (!descriptorsById.has(photoId)) {
        return;
      }
      const isWithheld = withheldPhotoIds.has(photoId);
      if (isWithheld === withheld) {
        return;
      }
      if (withheld) {
        withheldPhotoIds.add(photoId);
      } else {
        withheldPhotoIds.delete(photoId);
      }
      markDirty();
      notify();
    },
  };

  if (options.initialPage) {
    applyPage(options.initialPage);
  } else {
    void runLoad("initial");
  }

  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSequencePosition: (photoId) => {
      const index = sequenceIndexByPhotoId.get(photoId);
      if (index === undefined) {
        return undefined;
      }
      return { index, ...(isExhausted ? { total: descriptorOrder.length } : {}) };
    },
    intents,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      currentAbortController?.abort();
      currentAbortController = undefined;
      for (const controller of renewalAbortControllers) {
        controller.abort();
      }
      renewalAbortControllers.clear();
      listeners.clear();
    },
  };
};
