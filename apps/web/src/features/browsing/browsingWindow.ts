import { getCapturedAtComponents, type CapturedAt, type PhotoCollection, type TimelinePhoto, type TimelineThumbnailSources } from "@album/shared";
import { AlbumTransportError, type AlbumTransportErrorCode } from "../../lib/albumTransport.js";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";
import { createBrowserEnvironment, type BrowsingEnvironment } from "./browsingEnvironment.js";
import { createIncrementalJustifiedRows, type JustifiedLayoutItem, type JustifiedRowsOptions } from "./justifiedRows.js";
import { captureAnchor, resolveAnchor, type CapturedAnchor, type RestorationDirective } from "./restoration.js";
import { createThumbnailLeaseCache } from "./thumbnailLeaseCache.js";

export type { RestorationDirective } from "./restoration.js";

/** One loaded Photo's compact, URL-free layout facts (ADR-0050): temporary access lives only in the lease cache. */
interface PhotoDescriptor {
  photoId: string;
  fileName: string;
  capturedAt: CapturedAt;
  addedAt: string;
  displayDimensions: { width: number; height: number };
  aspectRatio: number;
  periodKey: string;
  favourite: boolean;
  deletedAt?: string;
}

export interface SequencePosition {
  /** Zero-based position from the newest loaded Photo. */
  index: number;
  /** Only present once the collection is fully loaded (`isExhausted`). */
  total?: number;
}

export type CellPresentation =
  | { kind: "ready"; sources: TimelineThumbnailSources; leaseRevision: number }
  | { kind: "loading" }
  | { kind: "placeholder" }
  | { kind: "withheld" };

export interface RenderReadyCell {
  photoId: string;
  fileName: string;
  capturedAt: CapturedAt;
  width: number;
  sequencePosition: SequencePosition;
  presentation: CellPresentation;
  favourite: boolean;
  deletedAt?: string;
}

export interface BrowsingMonthMarker {
  kind: "month-marker";
  periodKey: string;
}

export interface BrowsingRow {
  kind: "row";
  periodKey: string;
  height: number;
  cells: RenderReadyCell[];
}

export type BrowsingLayoutItem = BrowsingMonthMarker | BrowsingRow;

export type BrowsingCollectionState = "loading" | "empty" | "ready" | "initial-failure" | "tail-failure";

export interface BrowsingWindowSnapshot {
  collection: PhotoCollection;
  state: BrowsingCollectionState;
  layoutItems: BrowsingLayoutItem[];
  isExhausted: boolean;
  /** Non-blocking suspension for presentation only; never requires a Retry (ADR-0055). */
  offline: boolean;
  restorationDirective?: RestorationDirective;
}

export type LayoutOptions = Omit<JustifiedRowsOptions, "hasMore">;

export interface ViewportObservation {
  containerWidth: number;
  /** Layout-item indices actually visible -- not the virtualizer's overscanned range. */
  visibleItemRange?: { startIndex: number; endIndex: number };
  /** Pixel offset of the first visible item's start from the content viewport top (for anchor capture). */
  visibleItemTopOffset?: number;
  /** Viewport extent (px) driving the two-viewport soon-visible paging policy. */
  viewportExtent?: number;
  /** Layout-item index holding DOM focus; kept in demand even off-screen. */
  focusedItemIndex?: number;
  scrollOrigin: "user" | "programmatic" | "initial";
  /** Present only when this observation is the adapter's acknowledgement of a restoration directive. */
  appliedRestorationRevision?: number;
}

export interface ThumbnailOutcomeObservation {
  photoId: string;
  leaseRevision: number;
  outcome: "loaded" | "failed";
}

/** UI-facing surface (ADR-0055): no `loadMore`, access commands, anchor recording, or lifecycle. */
export interface BrowsingWindowIntents {
  observeViewport(observation: ViewportObservation): void;
  reportThumbnailOutcome(observation: ThumbnailOutcomeObservation): void;
  /** Clears a genuine paused collection failure and re-evaluates current viewport demand; a no-op otherwise. */
  retry(): void;
}

/** Registry-only surface (ADR-0057/0065): React never calls these. */
export interface BrowsingWindowLifecycle {
  activate(): void;
  deactivate(): void;
  dispose(): void;
  /** ADR-0067: marks/unmarks a loaded descriptor as withheld without moving or removing it. */
  setWithheld(photoId: string, withheld: boolean): void;
}

export interface BrowsingWindow {
  getSnapshot(): BrowsingWindowSnapshot;
  subscribe(listener: () => void): () => void;
  intents: BrowsingWindowIntents;
  lifecycle: BrowsingWindowLifecycle;
}

export interface BrowsingWindowOptions {
  collection: PhotoCollection;
  /** A navigation anchor ("YYYY-MM" or "YYYY-unknown") for the initial load; absent starts at the latest Photo. */
  startAt?: string;
  port: AlbumBrowsingPort;
  layout: LayoutOptions;
  /**
   * A page already fetched for this exact `collection`/`startAt` (ADR-0058's date-Jump probe).
   * Ingested at construction; does not itself start any network work.
   */
  initialPage?: { photos: TimelinePhoto[]; nextCursor?: string; expiresAt?: string };
  environment?: BrowsingEnvironment;
  /** Internal test seam: the non-demand lease LRU bound (ADR-0050, calibrated by the 20,000-Photo profile). */
  nonDemandLeaseLimit?: number;
}

const RENEWAL_LEAD_MS = 60_000;
const MAX_RENEWAL_BATCH = 100;
const RENEWAL_BACKOFF_BASE_MS = 5_000;
const RENEWAL_BACKOFF_MAX_MS = 5 * 60_000;
const MONTH_MARKER_HEIGHT_ESTIMATE = 56;
/** Calibrated by the 20,000-Photo performance profile (ADR-0050); not a product contract. */
const DEFAULT_NON_DEMAND_LEASE_LIMIT = 1500;

/** ADR-0055: one deep module per history entry's Browsing Window. */
export const createBrowsingWindow = (options: BrowsingWindowOptions): BrowsingWindow => {
  const { collection, startAt, port } = options;
  const environment = options.environment ?? createBrowserEnvironment();
  const leaseCache = createThumbnailLeaseCache(options.nonDemandLeaseLimit ?? DEFAULT_NON_DEMAND_LEASE_LIMIT);

  let disposed = false;
  let isActive = false;
  let currentGeneration = 0;

  let layoutOptions = options.layout;
  let lastEffectiveWidth: number | undefined;
  const listeners = new Set<() => void>();

  const descriptorsById = new Map<string, PhotoDescriptor>();
  const descriptorOrder: string[] = [];
  const sequenceIndexByPhotoId = new Map<string, number>();
  const withheldPhotoIds = new Set<string>();

  let nextCursor: string | undefined;
  let isExhausted = false;
  let isLoadingPage = false;
  let loadError: AlbumTransportErrorCode | undefined;
  let currentLoadAbortController: AbortController | undefined;

  const renewalInFlight = new Set<string>();
  const renewalAbortControllers = new Set<AbortController>();
  let renewalBackoffMs = 0;
  let renewalBlockedUntilMs = 0;
  // A 401 invalidates the Session globally (albumTransport's `sessionExpiredEvent`); this window
  // just needs to stop asking once that's happened, not run its own parallel sign-out.
  let renewalAuthLost = false;
  let cancelScheduledRenewal: (() => void) | undefined;

  // Per-Photo image-failure recovery, keyed by lease revision (ADR-0051): the revision that
  // triggered a forced renewal, cleared on success or once a second, still-failing revision
  // becomes a placeholder.
  const failureRevisionByPhotoId = new Map<string, number>();
  const placeholderRevisionByPhotoId = new Map<string, number>();

  let lastViewport: ViewportObservation | undefined;
  let demandPhotoIds = new Set<string>();
  let unsubscribeOnline: (() => void) | undefined;
  let unsubscribeVisible: (() => void) | undefined;

  let lastCapturedAnchor: CapturedAnchor | undefined;
  let pendingCapturedAnchor: CapturedAnchor | undefined;
  let restorationDirective: RestorationDirective | undefined;
  let restorationRevisionCounter = 0;

  let layoutDirty = true;
  let layoutStructurallyDirty = true;
  let consumedDescriptorCount = 0;
  const incrementalLayout = createIncrementalJustifiedRows();
  let cachedInternalItems: JustifiedLayoutItem[] = [];
  let cachedIncompleteTail: string[] | undefined;
  let presentationDirtyPhotoIds = new Set<string>();
  let previousRowsByKey = new Map<string, BrowsingRow>();
  let previousInternalItemByKey = new Map<string, JustifiedLayoutItem>();
  let cachedRenderItems: BrowsingLayoutItem[] = [];
  let cachedSnapshot: BrowsingWindowSnapshot | undefined;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const invalidateSnapshot = (): void => {
    cachedSnapshot = undefined;
  };

  const periodKeyOf = (capturedAt: CapturedAt): string => {
    const { year, month } = getCapturedAtComponents(capturedAt);
    const paddedYear = String(year).padStart(4, "0");
    return month !== undefined ? `${paddedYear}-${String(month).padStart(2, "0")}` : `${paddedYear}-unknown`;
  };

  const toDescriptor = (photo: TimelinePhoto): PhotoDescriptor => ({
    photoId: photo.photoId,
    fileName: photo.fileName,
    capturedAt: photo.capturedAt,
    addedAt: photo.addedAt,
    displayDimensions: photo.displayDimensions,
    aspectRatio: photo.displayDimensions.width / photo.displayDimensions.height,
    periodKey: periodKeyOf(photo.capturedAt),
    favourite: photo.favourite,
    ...(photo.deletedAt !== undefined ? { deletedAt: photo.deletedAt } : {}),
  });

  const toLayoutDescriptor = (photoId: string): { photoId: string; aspectRatio: number; periodKey: string } => {
    const descriptor = descriptorsById.get(photoId)!;
    return { photoId: descriptor.photoId, aspectRatio: descriptor.aspectRatio, periodKey: descriptor.periodKey };
  };

  const classifyError = (error: unknown): AlbumTransportErrorCode => (error instanceof AlbumTransportError ? error.code : "unexpected");

  const applyPage = (page: { photos: TimelinePhoto[]; nextCursor?: string; expiresAt?: string }): void => {
    for (const photo of page.photos) {
      // First-seen descriptor and position win; a later duplicate cursor result is ignored.
      if (!descriptorsById.has(photo.photoId)) {
        descriptorsById.set(photo.photoId, toDescriptor(photo));
        sequenceIndexByPhotoId.set(photo.photoId, descriptorOrder.length);
        descriptorOrder.push(photo.photoId);
      }
    }
    nextCursor = page.nextCursor;
    isExhausted = page.nextCursor === undefined;
    layoutDirty = true;

    // Recompute demand against the freshly-arrived layout *before* ingesting leases below, so the
    // LRU's eviction decisions already know which of these new Photos are actually in view rather
    // than judging them all as equally non-demand against a now-stale viewport (ADR-0050).
    ensureLayoutBuilt();
    if (lastViewport) {
      recomputeDemandSet();
    }

    // Temporary URLs are split from the compact descriptor at ingestion (ADR-0050): they only ever
    // live in the lease cache.
    const expiresAtMs = page.expiresAt !== undefined ? Date.parse(page.expiresAt) : undefined;
    if (expiresAtMs !== undefined) {
      for (const photo of page.photos) {
        const { evictedIds } = leaseCache.put(photo.photoId, photo.timelineThumbnailSources, expiresAtMs);
        presentationDirtyPhotoIds.add(photo.photoId);
        for (const evictedId of evictedIds) {
          presentationDirtyPhotoIds.add(evictedId);
        }
      }
    }
  };

  const ensureLayoutBuilt = (): void => {
    if (!layoutDirty) {
      return;
    }
    const layoutRowOptions: JustifiedRowsOptions = { ...layoutOptions, hasMore: !isExhausted && loadError === undefined };
    const result = layoutStructurallyDirty
      ? incrementalLayout.reset(descriptorOrder.map(toLayoutDescriptor), layoutRowOptions)
      : incrementalLayout.append(descriptorOrder.slice(consumedDescriptorCount).map(toLayoutDescriptor), layoutRowOptions);
    consumedDescriptorCount = descriptorOrder.length;
    layoutStructurallyDirty = false;
    cachedInternalItems = result.items;
    cachedIncompleteTail = result.incompleteTailPhotoIds;
    layoutDirty = false;

    if (pendingCapturedAnchor) {
      const anchor = pendingCapturedAnchor;
      pendingCapturedAnchor = undefined;
      const resolved = resolveAnchor(cachedInternalItems, anchor);
      restorationDirective = resolved
        ? {
            revision: restorationRevisionCounter,
            kind: resolved.kind,
            rowOffset: resolved.rowOffset,
            ...(resolved.photoId !== undefined ? { photoId: resolved.photoId } : {}),
            ...(resolved.periodKey !== undefined ? { periodKey: resolved.periodKey } : {}),
          }
        : undefined;
    }
  };

  const sequencePositionOf = (photoId: string): SequencePosition => {
    const index = sequenceIndexByPhotoId.get(photoId)!;
    return { index, ...(isExhausted ? { total: descriptorOrder.length } : {}) };
  };

  const presentationFor = (photoId: string): CellPresentation => {
    if (withheldPhotoIds.has(photoId)) {
      return { kind: "withheld" };
    }
    const lease = leaseCache.get(photoId);
    if (lease && placeholderRevisionByPhotoId.get(photoId) === lease.revision) {
      return { kind: "placeholder" };
    }
    if (lease) {
      return { kind: "ready", sources: lease.sources, leaseRevision: lease.revision };
    }
    return { kind: "loading" };
  };

  const rowKeyOf = (item: Extract<JustifiedLayoutItem, { kind: "row" }>): string => `${item.periodKey}:${item.photoIds.join(",")}`;

  const rebuildRenderItemsIfNeeded = (): void => {
    if (!layoutStructurallyDirty && presentationDirtyPhotoIds.size === 0 && cachedRenderItems.length > 0 && !cachedInternalItemsChangedSinceRender()) {
      return;
    }
    const nextRowsByKey = new Map<string, BrowsingRow>();
    const nextInternalItemByKey = new Map<string, JustifiedLayoutItem>();
    const forceAll = layoutStructurallyDirty;
    const renderItems: BrowsingLayoutItem[] = cachedInternalItems.map((item) => {
      if (item.kind === "month-marker") {
        return { kind: "month-marker", periodKey: item.periodKey };
      }
      const key = rowKeyOf(item);
      nextInternalItemByKey.set(key, item);
      const isRowDirty = forceAll || previousInternalItemByKey.get(key) !== item || item.photoIds.some((id) => presentationDirtyPhotoIds.has(id));
      const previous = previousRowsByKey.get(key);
      if (!isRowDirty && previous) {
        nextRowsByKey.set(key, previous);
        return previous;
      }
      const row: BrowsingRow = {
        kind: "row",
        periodKey: item.periodKey,
        height: item.height,
        cells: item.photoIds.map((photoId, index) => ({
          photoId,
          fileName: descriptorsById.get(photoId)!.fileName,
          capturedAt: descriptorsById.get(photoId)!.capturedAt,
          width: item.itemWidths[index] ?? item.height,
          sequencePosition: sequencePositionOf(photoId),
          presentation: presentationFor(photoId),
          favourite: descriptorsById.get(photoId)!.favourite,
          ...(descriptorsById.get(photoId)!.deletedAt !== undefined ? { deletedAt: descriptorsById.get(photoId)!.deletedAt } : {}),
        })),
      };
      nextRowsByKey.set(key, row);
      return row;
    });
    cachedRenderItems = renderItems;
    previousRowsByKey = nextRowsByKey;
    previousInternalItemByKey = nextInternalItemByKey;
    presentationDirtyPhotoIds = new Set();
  };

  // Tracks whether ensureLayoutBuilt produced a structurally new `cachedInternalItems` array since
  // the last render pass, even when nothing is presentation-dirty (e.g. a page appended new rows).
  let lastRenderedInternalItems: JustifiedLayoutItem[] | undefined;
  const cachedInternalItemsChangedSinceRender = (): boolean => {
    const changed = lastRenderedInternalItems !== cachedInternalItems;
    lastRenderedInternalItems = cachedInternalItems;
    return changed;
  };

  const deriveState = (): BrowsingCollectionState => {
    if (cachedInternalItems.length === 0) {
      if (loadError !== undefined) {
        return "initial-failure";
      }
      return isExhausted ? "empty" : "loading";
    }
    return loadError !== undefined ? "tail-failure" : "ready";
  };

  const getSnapshot = (): BrowsingWindowSnapshot => {
    ensureLayoutBuilt();
    rebuildRenderItemsIfNeeded();
    if (!cachedSnapshot) {
      cachedSnapshot = {
        collection,
        state: deriveState(),
        layoutItems: cachedRenderItems,
        isExhausted,
        offline: !environment.isOnline(),
        ...(restorationDirective ? { restorationDirective } : {}),
      };
    }
    return cachedSnapshot;
  };

  const computeSoonVisibleEndIndex = (endIndex: number, viewportExtent: number | undefined): number => {
    const extent = viewportExtent ?? layoutOptions.targetRowHeight * 3;
    let accumulated = 0;
    let index = endIndex;
    while (accumulated < extent && index < cachedInternalItems.length - 1) {
      index += 1;
      const item = cachedInternalItems[index];
      accumulated += item?.kind === "row" ? item.height + layoutOptions.spacing : MONTH_MARKER_HEIGHT_ESTIMATE;
    }
    return index;
  };

  const photoIdsAt = (index: number | undefined): string[] => {
    if (index === undefined) {
      return [];
    }
    const item = cachedInternalItems[index];
    return item?.kind === "row" ? item.photoIds : [];
  };

  const recomputeDemandSet = (): void => {
    const range = lastViewport?.visibleItemRange;
    const ids = new Set<string>();
    if (range) {
      const soonVisibleEndIndex = computeSoonVisibleEndIndex(range.endIndex, lastViewport?.viewportExtent);
      for (let index = range.startIndex; index <= soonVisibleEndIndex; index += 1) {
        for (const photoId of photoIdsAt(index)) {
          ids.add(photoId);
        }
      }
    }
    for (const photoId of photoIdsAt(lastViewport?.focusedItemIndex)) {
      ids.add(photoId);
    }
    demandPhotoIds = ids;
    for (const evictedId of leaseCache.setDemand(ids)) {
      presentationDirtyPhotoIds.add(evictedId);
    }
  };

  const runLoad = async (generationAtStart: number): Promise<void> => {
    const controller = new AbortController();
    currentLoadAbortController = controller;
    isLoadingPage = true;
    invalidateSnapshot();
    notify();
    try {
      const page = await port.loadCollectionPage({
        collection,
        ...(descriptorOrder.length === 0 && nextCursor === undefined && startAt !== undefined ? { startAt } : {}),
        ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
        signal: controller.signal,
      });
      if (disposed || !isActive || generationAtStart !== currentGeneration) {
        return;
      }
      applyPage(page);
    } catch (error) {
      if (disposed || !isActive || generationAtStart !== currentGeneration) {
        return;
      }
      // A request cancelled or rejected across an offline transition is a suspension, not a
      // failure (ADR-0051/0055): it doesn't consume a Retry, and demand re-evaluates on its own
      // once online returns.
      if (!environment.isOnline()) {
        return;
      }
      loadError = classifyError(error);
      // A failed load also relaxes any withheld tail into a visible final row (`hasMore` folds in `loadError`).
      layoutDirty = true;
      invalidateSnapshot();
    } finally {
      if (currentLoadAbortController === controller) {
        currentLoadAbortController = undefined;
      }
      if (!disposed && isActive && generationAtStart === currentGeneration) {
        isLoadingPage = false;
        invalidateSnapshot();
        notify();
        evaluateDemand();
      }
    }
  };

  const maybeStartPageLoad = (): void => {
    if (isLoadingPage || currentLoadAbortController !== undefined) {
      return;
    }
    if (isExhausted || loadError !== undefined) {
      return;
    }
    if (!environment.isOnline() || !environment.isVisible()) {
      return;
    }
    // A withheld incomplete tail always needs another page to resolve, regardless of item count:
    // it's the only way that trailing period's Photos can ever become a renderable row.
    if (cachedIncompleteTail === undefined) {
      const range = lastViewport?.visibleItemRange;
      const soonVisibleEndIndex = range ? computeSoonVisibleEndIndex(range.endIndex, lastViewport?.viewportExtent) : 0;
      if (cachedInternalItems.length - 1 >= soonVisibleEndIndex) {
        return;
      }
    }
    void runLoad(currentGeneration);
  };

  const runRenewal = async (photoIds: string[], generationAtStart: number): Promise<void> => {
    for (const photoId of photoIds) {
      renewalInFlight.add(photoId);
    }
    const controller = new AbortController();
    renewalAbortControllers.add(controller);
    try {
      const response = await port.renewThumbnailAccess({ photoIds, signal: controller.signal });
      if (disposed || !isActive || generationAtStart !== currentGeneration) {
        return;
      }
      const expiresAtMs = Date.parse(response.expiresAt);
      for (const renewed of response.photos) {
        if (!descriptorsById.has(renewed.photoId)) {
          continue;
        }
        const { evictedIds } = leaseCache.put(renewed.photoId, renewed.timelineThumbnailSources, expiresAtMs);
        presentationDirtyPhotoIds.add(renewed.photoId);
        for (const evictedId of evictedIds) {
          presentationDirtyPhotoIds.add(evictedId);
        }
      }
      renewalBackoffMs = 0;
      renewalBlockedUntilMs = 0;
      invalidateSnapshot();
      notify();
    } catch (error) {
      if (disposed || !isActive || generationAtStart !== currentGeneration) {
        return;
      }
      // A request cancelled or rejected across an offline transition doesn't consume a Photo's
      // recovery attempt or trigger backoff (ADR-0051): it's a suspension, not a failure.
      if (!environment.isOnline()) {
        return;
      }
      if (classifyError(error) === "auth_lost") {
        renewalAuthLost = true;
      } else {
        renewalBackoffMs = renewalBackoffMs === 0 ? RENEWAL_BACKOFF_BASE_MS : Math.min(renewalBackoffMs * 2, RENEWAL_BACKOFF_MAX_MS);
        renewalBlockedUntilMs = environment.now() + renewalBackoffMs;
      }
    } finally {
      renewalAbortControllers.delete(controller);
      for (const photoId of photoIds) {
        renewalInFlight.delete(photoId);
      }
      if (!disposed && isActive && generationAtStart === currentGeneration) {
        rescheduleRenewalTimer();
      }
    }
  };

  const maybeRenewLeases = (): void => {
    if (renewalAuthLost) {
      return;
    }
    if (!environment.isOnline() || !environment.isVisible()) {
      return;
    }
    const now = environment.now();
    if (now < renewalBlockedUntilMs) {
      return;
    }
    const due = [...demandPhotoIds]
      .filter((photoId) => !renewalInFlight.has(photoId))
      .filter((photoId) => {
        const lease = leaseCache.get(photoId);
        return lease === undefined || lease.expiresAtMs - now <= RENEWAL_LEAD_MS;
      })
      .slice(0, MAX_RENEWAL_BATCH);
    if (due.length === 0) {
      return;
    }
    void runRenewal(due, currentGeneration);
  };

  const rescheduleRenewalTimer = (): void => {
    cancelScheduledRenewal?.();
    cancelScheduledRenewal = undefined;
    if (disposed || !isActive || renewalAuthLost) {
      return;
    }
    if (!environment.isOnline() || !environment.isVisible()) {
      return;
    }
    const now = environment.now();
    let deadline: number | undefined;
    for (const photoId of demandPhotoIds) {
      // An in-flight renewal already has its own reschedule waiting in `runRenewal`'s `finally`;
      // computing a deadline for it here too would keep re-scheduling "now" until it settles.
      if (renewalInFlight.has(photoId)) {
        continue;
      }
      const lease = leaseCache.get(photoId);
      const dueAt = lease === undefined ? now : lease.expiresAtMs - RENEWAL_LEAD_MS;
      if (deadline === undefined || dueAt < deadline) {
        deadline = dueAt;
      }
    }
    if (deadline === undefined) {
      return;
    }
    deadline = Math.max(deadline, renewalBlockedUntilMs);
    const generationAtSchedule = currentGeneration;
    cancelScheduledRenewal = environment.scheduleAt(deadline, () => {
      if (disposed || !isActive || generationAtSchedule !== currentGeneration) {
        return;
      }
      maybeRenewLeases();
      rescheduleRenewalTimer();
    });
  };

  const evaluateDemand = (): void => {
    if (disposed || !isActive) {
      return;
    }
    ensureLayoutBuilt();
    if (lastViewport) {
      recomputeDemandSet();
    }
    maybeStartPageLoad();
    maybeRenewLeases();
    rescheduleRenewalTimer();
  };

  const discardExpiredLeases = (): void => {
    const now = environment.now();
    for (const photoId of demandPhotoIds) {
      const lease = leaseCache.get(photoId);
      if (lease && lease.expiresAtMs <= now) {
        leaseCache.delete(photoId);
        presentationDirtyPhotoIds.add(photoId);
      }
    }
    invalidateSnapshot();
  };

  const applyWidthChangeIfNeeded = (containerWidth: number): void => {
    if (lastEffectiveWidth === containerWidth) {
      return;
    }
    const isFirstObservation = lastEffectiveWidth === undefined;
    lastEffectiveWidth = containerWidth;
    layoutOptions = { ...layoutOptions, containerWidth };
    layoutStructurallyDirty = true;
    layoutDirty = true;
    if (!isFirstObservation && lastCapturedAnchor) {
      restorationRevisionCounter += 1;
      pendingCapturedAnchor = lastCapturedAnchor;
    }
  };

  const observeViewport = (observation: ViewportObservation): void => {
    if (disposed || !isActive) {
      return;
    }

    if (restorationDirective) {
      if (observation.scrollOrigin === "user" || observation.appliedRestorationRevision === restorationDirective.revision) {
        restorationDirective = undefined;
      }
    }

    applyWidthChangeIfNeeded(observation.containerWidth);
    lastViewport = observation;
    ensureLayoutBuilt();

    if (observation.visibleItemRange && restorationDirective === undefined) {
      lastCapturedAnchor = captureAnchor(
        cachedInternalItems,
        observation.visibleItemRange.startIndex,
        observation.visibleItemTopOffset ?? 0,
        descriptorOrder,
      );
    }

    invalidateSnapshot();
    notify();
    evaluateDemand();
  };

  const reportThumbnailOutcome = ({ photoId, leaseRevision, outcome }: ThumbnailOutcomeObservation): void => {
    if (disposed || !isActive) {
      return;
    }
    const lease = leaseCache.get(photoId);
    if (!lease || lease.revision !== leaseRevision) {
      return;
    }
    if (outcome === "loaded") {
      if (failureRevisionByPhotoId.has(photoId) || placeholderRevisionByPhotoId.has(photoId)) {
        failureRevisionByPhotoId.delete(photoId);
        placeholderRevisionByPhotoId.delete(photoId);
        presentationDirtyPhotoIds.add(photoId);
        invalidateSnapshot();
        notify();
      }
      return;
    }
    const forcedAtRevision = failureRevisionByPhotoId.get(photoId);
    if (forcedAtRevision === undefined) {
      failureRevisionByPhotoId.set(photoId, leaseRevision);
      if (!renewalInFlight.has(photoId)) {
        void runRenewal([photoId], currentGeneration);
      }
      return;
    }
    if (forcedAtRevision === leaseRevision) {
      // Duplicate failure report for the same still-unrenewed revision; already recovering.
      return;
    }
    // The renewed revision also failed: settle into a static placeholder for this revision.
    placeholderRevisionByPhotoId.set(photoId, leaseRevision);
    failureRevisionByPhotoId.delete(photoId);
    presentationDirtyPhotoIds.add(photoId);
    invalidateSnapshot();
    notify();
  };

  const retry = (): void => {
    if (disposed || !isActive || loadError === undefined) {
      return;
    }
    loadError = undefined;
    layoutDirty = true;
    invalidateSnapshot();
    notify();
    evaluateDemand();
  };

  const stopActiveWork = (): void => {
    currentLoadAbortController?.abort();
    currentLoadAbortController = undefined;
    isLoadingPage = false;
    for (const controller of renewalAbortControllers) {
      controller.abort();
    }
    renewalAbortControllers.clear();
    renewalInFlight.clear();
    cancelScheduledRenewal?.();
    cancelScheduledRenewal = undefined;
    unsubscribeOnline?.();
    unsubscribeOnline = undefined;
    unsubscribeVisible?.();
    unsubscribeVisible = undefined;
    lastViewport = undefined;
    demandPhotoIds = new Set();
    leaseCache.setDemand(new Set());
    for (const photoId of leaseCache.clear()) {
      presentationDirtyPhotoIds.add(photoId);
    }
    failureRevisionByPhotoId.clear();
    placeholderRevisionByPhotoId.clear();
  };

  const activate = (): void => {
    if (disposed || isActive) {
      return;
    }
    isActive = true;
    currentGeneration += 1;
    unsubscribeOnline = environment.onOnlineChange((online) => {
      if (!isActive) {
        return;
      }
      invalidateSnapshot();
      notify();
      if (online) {
        evaluateDemand();
      }
    });
    unsubscribeVisible = environment.onVisibleChange((visible) => {
      if (!isActive) {
        return;
      }
      if (visible) {
        discardExpiredLeases();
        evaluateDemand();
      }
    });
    invalidateSnapshot();
    notify();
  };

  const deactivate = (): void => {
    if (disposed || !isActive) {
      return;
    }
    isActive = false;
    stopActiveWork();
    invalidateSnapshot();
    notify();
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (isActive) {
      isActive = false;
      stopActiveWork();
    }
    listeners.clear();
  };

  const setWithheld = (photoId: string, withheld: boolean): void => {
    if (disposed || !descriptorsById.has(photoId)) {
      return;
    }
    if (withheldPhotoIds.has(photoId) === withheld) {
      return;
    }
    if (withheld) {
      withheldPhotoIds.add(photoId);
    } else {
      withheldPhotoIds.delete(photoId);
    }
    presentationDirtyPhotoIds.add(photoId);
    invalidateSnapshot();
    notify();
  };

  if (options.initialPage) {
    applyPage(options.initialPage);
  }

  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    intents: { observeViewport, reportThumbnailOutcome, retry },
    lifecycle: { activate, deactivate, dispose, setWithheld },
  };
};
