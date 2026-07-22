import { getCapturedAtComponents, type CapturedAt, type PhotoCollection, type TimelinePhotoV2 } from "@album/shared";
import { AlbumTransportError, type AlbumTransportErrorCode } from "../../lib/albumTransport.js";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";
import { createIncrementalJustifiedRows, type JustifiedLayoutItem, type JustifiedRowsOptions } from "./justifiedRows.js";

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
  /**
   * Coalesced renewal demand: renews only the ids nearing expiry, batched under the port's
   * limit. A failure starts a bounded backoff window that silently skips subsequent demand
   * calls until it elapses; pass `force` (an online/visibility/retry-window resume signal) to
   * bypass that window and retry immediately.
   */
  requestThumbnailAccess(photoIds: string[], options?: { force?: boolean }): void;
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
const RENEWAL_BACKOFF_BASE_MS = 5_000;
const RENEWAL_BACKOFF_MAX_MS = 5 * 60_000;

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
  let renewalBackoffMs = 0;
  let renewalBlockedUntilMs = 0;
  // A 401 invalidates the Session globally (albumTransport's `sessionExpiredEvent`); this window
  // just needs to stop asking once that's happened, not run its own parallel sign-out.
  let renewalAuthLost = false;

  let nextCursor: string | undefined;
  let isExhausted = false;
  let isLoadingInitial = false;
  let isLoadingMore = false;
  let loadError: AlbumTransportErrorCode | undefined;
  let lastLoadKind: "initial" | "more" = "initial";
  let currentAbortController: AbortController | undefined;
  let restorationAnchor: RestorationAnchor | undefined;

  let dirty = true;
  let layoutOptionsDirty = true;
  let consumedDescriptorCount = 0;
  const incrementalLayout = createIncrementalJustifiedRows();
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

  const renewThumbnailAccess = async (photoIds: string[], options?: { force?: boolean }): Promise<void> => {
    if (disposed || renewalAuthLost) {
      return;
    }
    const now = Date.now();
    if (!options?.force && now < renewalBlockedUntilMs) {
      return;
    }
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
      renewalBackoffMs = 0;
      renewalBlockedUntilMs = 0;
      markDirty();
      notify();
    } catch (error) {
      // A failed renewal leaves the existing (possibly expiring) sources in place; a bounded,
      // doubling backoff window silently absorbs the next few demand calls so a persistent
      // failure doesn't hammer the API, and an online/visibility/retry-window resume (`force`)
      // bypasses it. A 401 leaves the loop entirely instead -- the Session is already gone.
      if (classifyError(error) === "auth_lost") {
        renewalAuthLost = true;
      } else {
        renewalBackoffMs = renewalBackoffMs === 0 ? RENEWAL_BACKOFF_BASE_MS : Math.min(renewalBackoffMs * 2, RENEWAL_BACKOFF_MAX_MS);
        renewalBlockedUntilMs = Date.now() + renewalBackoffMs;
      }
    } finally {
      renewalAbortControllers.delete(controller);
      for (const photoId of due) {
        renewalInFlight.delete(photoId);
      }
    }
  };

  // A withheld descriptor stays in the layout input so its row/period never changes shape
  // or count (ADR-0067); only the rendering layer skips drawing it, using `withheldPhotoIds`.
  const toLayoutDescriptor = (photoId: string): { photoId: string; aspectRatio: number; periodKey: string } => {
    const descriptor = descriptorsById.get(photoId)!;
    return { photoId: descriptor.photoId, aspectRatio: descriptor.aspectRatio, periodKey: descriptor.periodKey };
  };

  const rebuildLayoutIfDirty = (): void => {
    if (!dirty) {
      return;
    }
    const options: JustifiedRowsOptions = {
      ...layoutOptions,
      // A failed load also relaxes the withheld tail into view (implementation doc "Justified Rows and Virtualisation").
      hasMore: !isExhausted && loadError === undefined,
    };
    // A container-width/spacing/target-height change invalidates every cached row's geometry, so
    // it forces a full rebuild; an ordinary new page only needs to fold in what's newly arrived
    // (see `createIncrementalJustifiedRows` -- a per-page full recompute is O(descriptors²) total
    // across a 20,000-Photo scroll session).
    const result = layoutOptionsDirty
      ? incrementalLayout.reset(descriptorOrder.map(toLayoutDescriptor), options)
      : incrementalLayout.append(descriptorOrder.slice(consumedDescriptorCount).map(toLayoutDescriptor), options);
    consumedDescriptorCount = descriptorOrder.length;
    layoutOptionsDirty = false;
    cachedLayoutItems = result.items;
    cachedIncompleteTail = result.incompleteTailPhotoIds;
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
      layoutOptionsDirty = true;
      markDirty();
      cachedSnapshot = undefined;
      notify();
    },
    recordRestorationAnchor: (anchor) => {
      restorationAnchor = anchor;
      cachedSnapshot = undefined;
      notify();
    },
    requestThumbnailAccess: (photoIds, options) => {
      void renewThumbnailAccess(photoIds, options);
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
