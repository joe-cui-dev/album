import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link, useLocation, useViewTransitionState } from "react-router";
import type { PhotoCollection } from "@album/shared";
import { formatCapturedAt, photoLinkName } from "../../lib/capturedAtFormat.js";
import { PHOTO_VIEW_TRANSITION_NAME } from "../../lib/viewTransitionNames.js";
import { BROWSING_ROW_SPACING, BROWSING_TARGET_ROW_HEIGHT } from "./browsingLayoutConstants.js";
import type { BrowsingWindow, PhotoDescriptor, RestorationAnchor } from "./browsingWindow.js";
import type { JustifiedLayoutItem } from "./justifiedRows.js";
import { TimelineThumbnailImage } from "./TimelineThumbnailImage.js";
import { useBrowsingWindowSnapshot } from "./useBrowsingWindow.js";

const SPACING = BROWSING_ROW_SPACING;
const TARGET_ROW_HEIGHT = BROWSING_TARGET_ROW_HEIGHT;
const MONTH_MARKER_HEIGHT = 56;
const LOAD_MORE_THRESHOLD_ITEMS = 6;
const RENEWAL_POLL_MS = 20_000;

interface BrowsingGridProps {
  browsingWindow: BrowsingWindow;
  photoHrefFor: (photoId: string) => string;
  emptyState: { title: string; description: string; action?: ReactNode };
  sourceCollection: PhotoCollection;
  /** Fires as the topmost visible period changes, for the date navigation's active styling only. */
  onVisiblePeriodChange?: (periodKey: string) => void;
  /** Exact Photo counts per periodKey, from Album Navigation, for the month marker's second line. */
  periodCounts?: ReadonlyMap<string, number>;
}

/** ADR-0064: TanStack Virtual with window scrolling, driven entirely by the Browsing Window's own snapshot. */
export function BrowsingGrid({
  browsingWindow,
  photoHrefFor,
  emptyState,
  sourceCollection,
  onVisiblePeriodChange,
  periodCounts,
}: BrowsingGridProps) {
  const snapshot = useBrowsingWindowSnapshot(browsingWindow);
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const hasRestoredRef = useRef(false);
  const [currentPeriodKey, setCurrentPeriodKey] = useState<string>();

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) {
        setContainerWidth(width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (containerWidth === undefined || containerWidth <= 0) {
      return;
    }
    browsingWindow.intents.setLayout({ containerWidth, spacing: SPACING, targetRowHeight: TARGET_ROW_HEIGHT });
  }, [browsingWindow, containerWidth]);

  const layoutItems = snapshot.layoutItems;

  const virtualizer = useWindowVirtualizer({
    count: layoutItems.length,
    estimateSize: (index) => estimateItemSize(layoutItems[index]),
    overscan: 4,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisibleIndex = virtualItems[0]?.index;
  const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index;
  const visibleIndexRangeKey = virtualItems.map((item) => item.index).join(",");

  useEffect(() => {
    if (lastVisibleIndex === undefined) {
      return;
    }
    if (lastVisibleIndex >= layoutItems.length - LOAD_MORE_THRESHOLD_ITEMS) {
      browsingWindow.intents.loadMore();
    }
  }, [browsingWindow, lastVisibleIndex, layoutItems.length]);

  useEffect(() => {
    const visiblePhotoIds = virtualItems.flatMap((virtualItem) => {
      const item = layoutItems[virtualItem.index];
      return item?.kind === "row" ? item.photoIds : [];
    });
    if (visiblePhotoIds.length === 0) {
      return;
    }
    browsingWindow.intents.requestThumbnailAccess(visiblePhotoIds);
    // The interval is the "retry-window" resume point once a bounded backoff (owned by the
    // Browsing Window) elapses on its own; `online`/`visibilitychange` force an immediate
    // resume instead of waiting out the rest of that window (implementation doc
    // "Temporary-access recovery").
    const intervalId = window.setInterval(
      () => browsingWindow.intents.requestThumbnailAccess(visiblePhotoIds),
      RENEWAL_POLL_MS,
    );
    const onResumeSignal = (): void => browsingWindow.intents.requestThumbnailAccess(visiblePhotoIds, { force: true });
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        onResumeSignal();
      }
    };
    window.addEventListener("online", onResumeSignal);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", onResumeSignal);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // Re-runs only when the visible index set actually changes (visibleIndexRangeKey), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsingWindow, visibleIndexRangeKey]);

  useEffect(() => {
    if (hasRestoredRef.current || !snapshot.restorationAnchor || layoutItems.length === 0) {
      return;
    }
    const index = findAnchorIndex(layoutItems, snapshot.restorationAnchor);
    if (index !== undefined) {
      virtualizer.scrollToIndex(index, { align: "start" });
    }
    hasRestoredRef.current = true;
    // Restoration runs once, as soon as enough layout exists to locate the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutItems.length]);

  useEffect(() => {
    if (firstVisibleIndex === undefined) {
      return;
    }
    const item = layoutItems[firstVisibleIndex];
    const firstVirtualItem = virtualItems[0];
    if (!item || !firstVirtualItem) {
      return;
    }
    if (item.kind === "row") {
      browsingWindow.intents.recordRestorationAnchor({
        kind: "photo",
        photoId: item.photoIds[0]!,
        rowOffset: firstVirtualItem.start - (virtualizer.scrollOffset ?? 0),
      });
    } else {
      browsingWindow.intents.recordRestorationAnchor({ kind: "period", periodKey: item.periodKey });
    }
    // Scroll changes only the date navigation's active styling, never its disclosure (design doc "Date Navigation and History").
    setCurrentPeriodKey(item.periodKey);
    onVisiblePeriodChange?.(item.periodKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsingWindow, firstVisibleIndex]);

  if (snapshot.photoCount === 0 && !snapshot.isLoadingInitial && !snapshot.loadError) {
    return (
      <section className="empty-album">
        <h1>{emptyState.title}</h1>
        <p>{emptyState.description}</p>
        {emptyState.action}
      </section>
    );
  }

  // The very first page hasn't landed yet, so there's no real layout to virtualize -- a static
  // neutral placeholder fills that space instead of leaving it blank (design doc "Thumbnail
  // Loading": "a static neutral placeholder ... no shimmer").
  if (snapshot.isLoadingInitial && layoutItems.length === 0) {
    return (
      <div ref={containerRef}>
        <InitialLoadingPlaceholder />
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualItems.map((virtualItem) => {
          const item = layoutItems[virtualItem.index];
          if (!item) {
            return null;
          }
          return (
            <div
              data-index={virtualItem.index}
              key={virtualItem.key}
              style={{
                left: 0,
                position: "absolute",
                top: 0,
                transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
                width: "100%",
              }}
            >
              {item.kind === "month-marker" ? (
                <MonthMarker
                  count={periodCounts?.get(item.periodKey)}
                  isCurrent={item.periodKey === currentPeriodKey}
                  periodKey={item.periodKey}
                />
              ) : (
                <PhotoRow
                  browsingWindow={browsingWindow}
                  firstRowInView={virtualItem.index === (virtualItems[0]?.index ?? -1)}
                  inVisibleRange={
                    virtualizer.range === null ||
                    (virtualItem.index >= virtualizer.range.startIndex && virtualItem.index <= virtualizer.range.endIndex)
                  }
                  item={item}
                  location={location}
                  photoHrefFor={photoHrefFor}
                  snapshot={snapshot}
                  sourceCollection={sourceCollection}
                />
              )}
            </div>
          );
        })}
      </div>
      {snapshot.loadError ? (
        <p className="mt-4 flex items-center justify-between gap-3 rounded-md border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
          <span>Couldn&apos;t load more photos.</span>
          <button className="underline" onClick={() => browsingWindow.intents.retry()} type="button">
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}

const PLACEHOLDER_ROWS = [
  [2, 1, 3, 1],
  [1, 1, 1, 2],
];

/** Decorative only (`aria-hidden`): behaviour and copy are unchanged, this only replaces the
 * blank space that used to precede the first real row while `isLoadingInitial` is true. */
function InitialLoadingPlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="mb-1 h-14 w-48 bg-print-white/70" />
      {PLACEHOLDER_ROWS.map((widths, rowIndex) => (
        <div className="flex" key={rowIndex} style={{ gap: SPACING, height: TARGET_ROW_HEIGHT, marginBottom: SPACING }}>
          {widths.map((flex, itemIndex) => (
            <div className="rounded-sm bg-ink/5" key={itemIndex} style={{ flex }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Photographic data typography rail (design doc "Photographic Signature"): two stacked mono
 * lines, e.g. `JUL 2026` / `7 PHOTOS`. Exposure amber marks the current period without being the
 * sole signal -- `aria-current` and a heavier bottom border carry the same state non-visually
 * and non-colour, matching the year/period buttons' existing `aria-current` pattern. */
function MonthMarker({
  count,
  isCurrent,
  periodKey,
}: {
  count: number | undefined;
  isCurrent: boolean;
  periodKey: string;
}) {
  const { primary, secondary, accessible } = monthMarkerLabels(periodKey, count);
  return (
    <h2
      aria-current={isCurrent ? "true" : undefined}
      aria-label={accessible}
      className={`sticky z-10 flex flex-col justify-center gap-0.5 bg-print-white/90 px-1 backdrop-blur transition-colors duration-300 ${
        isCurrent ? "border-b-2 border-exposure/50 text-exposure" : "border-b border-line text-ink-muted"
      }`}
      style={{ height: MONTH_MARKER_HEIGHT, top: "var(--album-bar-height)" }}
    >
      <span aria-hidden="true" className="font-mono text-xs font-semibold uppercase tracking-wider">
        {primary}
      </span>
      {/* No dimming opacity here -- the parent's already-AA-compliant `text-exposure`/`text-ink-muted`
          colour carries the contrast; a smaller size alone gives the secondary line its hierarchy. */}
      <span aria-hidden="true" className="font-mono text-[0.65rem] uppercase tracking-wider">
        {secondary}
      </span>
    </h2>
  );
}

function PhotoRow({
  browsingWindow,
  firstRowInView,
  inVisibleRange,
  item,
  location,
  photoHrefFor,
  snapshot,
  sourceCollection,
}: {
  browsingWindow: BrowsingWindow;
  firstRowInView: boolean;
  inVisibleRange: boolean;
  item: Extract<JustifiedLayoutItem, { kind: "row" }>;
  location: ReturnType<typeof useLocation>;
  photoHrefFor: (photoId: string) => string;
  snapshot: ReturnType<typeof useBrowsingWindowSnapshot>;
  sourceCollection: PhotoCollection;
}) {
  return (
    <div className="flex" style={{ gap: SPACING, height: item.height }}>
      {item.photoIds.map((photoId, index) => {
        const descriptor = snapshot.descriptorsById.get(photoId);
        const width = item.itemWidths[index] ?? item.height;
        // A withheld Photo (membership change) keeps its row slot's exact geometry but renders nothing (ADR-0067).
        if (!descriptor || snapshot.withheldPhotoIds.has(photoId)) {
          return <span key={photoId} style={{ height: item.height, width }} />;
        }
        return (
          <PhotoLink
            browsingWindow={browsingWindow}
            descriptor={descriptor}
            fetchPriority={firstRowInView ? "high" : "auto"}
            height={item.height}
            key={photoId}
            loading={inVisibleRange ? "eager" : "lazy"}
            location={location}
            photoId={photoId}
            sourceCollection={sourceCollection}
            to={photoHrefFor(photoId)}
            width={width}
          />
        );
      })}
    </div>
  );
}

/** One Justified Row thumbnail Link. A dedicated component so `useViewTransitionState` -- legal
 * only at a stable per-item hook position -- can tell whether this exact Link is the one opening
 * the Viewer, and only then pair its image with the Viewer's via a shared `view-transition-name`
 * (ADR-0063's modal layer keeps this Link mounted underneath throughout the transition). */
function PhotoLink({
  browsingWindow,
  descriptor,
  fetchPriority,
  height,
  loading,
  location,
  photoId,
  sourceCollection,
  to,
  width,
}: {
  browsingWindow: BrowsingWindow;
  descriptor: PhotoDescriptor;
  fetchPriority: "high" | "auto";
  height: number;
  loading: "eager" | "lazy";
  location: ReturnType<typeof useLocation>;
  photoId: string;
  sourceCollection: PhotoCollection;
  to: string;
  width: number;
}) {
  const isOpeningViewer = useViewTransitionState(to);
  return (
    <Link
      aria-label={photoLinkName(descriptor.fileName, descriptor.capturedAt)}
      className="timeline-photo-link"
      state={{
        background: location,
        sequencePosition: browsingWindow.getSequencePosition(photoId),
        sourceCollection,
      }}
      style={{ height, width }}
      to={to}
      viewTransition
    >
      <span className="timeline-photo-thumb-wrap">
        <TimelineThumbnailImage
          fetchPriority={fetchPriority}
          height={height}
          loading={loading}
          sources={descriptor.timelineThumbnailSources}
          width={width}
          {...(isOpeningViewer ? { viewTransitionName: PHOTO_VIEW_TRANSITION_NAME } : {})}
        />
      </span>
      <span aria-hidden="true" className="timeline-photo-overlay">
        {formatCapturedAt(descriptor.capturedAt, "compact")}
      </span>
    </Link>
  );
}

const estimateItemSize = (item: JustifiedLayoutItem | undefined): number => {
  if (!item) {
    return TARGET_ROW_HEIGHT;
  }
  return item.kind === "month-marker" ? MONTH_MARKER_HEIGHT : item.height + SPACING;
};

/** The month marker's compact two-line text plus its full `aria-label`, from one `periodKey` parse. */
const monthMarkerLabels = (
  periodKey: string,
  count: number | undefined,
): { primary: string; secondary: string; accessible: string } => {
  const [yearPart, monthPart] = periodKey.split("-") as [string, string];
  const isDateUnknown = monthPart === "unknown";
  const primary = isDateUnknown ? yearPart : formatCapturedAt({ precision: "month", localDate: periodKey }, "compact");
  const accessibleBase = isDateUnknown
    ? `${yearPart}, Date unknown`
    : formatCapturedAt({ precision: "month", localDate: periodKey }, "accessible");
  const countSuffix = count !== undefined ? `${count} photos` : undefined;
  const secondary = isDateUnknown
    ? countSuffix !== undefined
      ? `Date unknown · ${countSuffix}`
      : "Date unknown"
    : (countSuffix ?? "");
  return {
    primary,
    secondary,
    accessible: countSuffix !== undefined ? `${accessibleBase}, ${countSuffix}` : accessibleBase,
  };
};

const findAnchorIndex = (
  layoutItems: JustifiedLayoutItem[],
  anchor: RestorationAnchor,
): number | undefined => {
  if (anchor.kind === "period") {
    const index = layoutItems.findIndex((item) => item.kind === "month-marker" && item.periodKey === anchor.periodKey);
    return index === -1 ? undefined : index;
  }
  const index = layoutItems.findIndex((item) => item.kind === "row" && item.photoIds.includes(anchor.photoId));
  return index === -1 ? undefined : index;
};
