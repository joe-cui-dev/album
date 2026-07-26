import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { defaultRangeExtractor, useWindowVirtualizer, type Range } from "@tanstack/react-virtual";
import { Link, useLocation, useViewTransitionState } from "react-router";
import type { PhotoCollection } from "@album/shared";
import { formatCapturedAt, photoLinkName } from "../../lib/capturedAtFormat.js";
import { PHOTO_VIEW_TRANSITION_NAME } from "../../lib/viewTransitionNames.js";
import { BROWSING_ROW_SPACING, BROWSING_TARGET_ROW_HEIGHT } from "./browsingLayoutConstants.js";
import type { BrowsingLayoutItem, BrowsingRow, BrowsingWindow, RenderReadyCell } from "./browsingWindow.js";
import { TimelineThumbnailImage } from "./TimelineThumbnailImage.js";
import { PrismaticEmptyState } from "./PrismaticEmptyState.js";
import { useBrowsingWindowSnapshot } from "./useBrowsingWindow.js";

const SPACING = BROWSING_ROW_SPACING;
const TARGET_ROW_HEIGHT = BROWSING_TARGET_ROW_HEIGHT;
const MONTH_MARKER_HEIGHT = 56;
/** DOM events that indicate an actual User scroll gesture, as opposed to a programmatic correction. */
const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown"] as const;

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

/**
 * ADR-0055/0064: a thin adapter over the Browsing Window's own snapshot. Owns only DOM/library
 * mechanics -- ResizeObserver, TanStack Virtual, DOM focus, and executing a restoration directive
 * -- and reports facts back through one viewport observation. It issues no load, access, or
 * anchor-recording commands of its own.
 */
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
  const [currentPeriodKey, setCurrentPeriodKey] = useState<string>();
  const [focusedItemIndex, setFocusedItemIndex] = useState<number>();

  const userScrolledRef = useRef(false);
  const appliedRestorationRevisionRef = useRef<number | undefined>(undefined);
  const pendingAckRevisionRef = useRef<number | undefined>(undefined);
  const hasSentObservationRef = useRef(false);

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
    const markUserScroll = (): void => {
      userScrolledRef.current = true;
    };
    for (const eventName of USER_SCROLL_EVENTS) {
      window.addEventListener(eventName, markUserScroll, { passive: true });
    }
    return () => {
      for (const eventName of USER_SCROLL_EVENTS) {
        window.removeEventListener(eventName, markUserScroll);
      }
    };
  }, []);

  const layoutItems = snapshot.layoutItems;

  // Keeps the focused row's item mounted even once scrolled past the default overscan window
  // (ADR-0049: "that row remains mounted until focus moves"), so native Photo Link focus survives
  // continued keyboard navigation instead of the virtualizer unmounting it mid-tab.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indices = new Set(defaultRangeExtractor(range));
      if (focusedItemIndex !== undefined) {
        indices.add(focusedItemIndex);
      }
      return [...indices].sort((a, b) => a - b);
    },
    [focusedItemIndex],
  );

  const virtualizer = useWindowVirtualizer({
    count: layoutItems.length,
    estimateSize: (index) => estimateItemSize(layoutItems[index]),
    overscan: 4,
    rangeExtractor,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const actualRange = virtualizer.range;
  const visibleRangeKey = actualRange ? `${actualRange.startIndex}-${actualRange.endIndex}` : "none";

  // Executes the current restoration directive exactly once per revision, then applies the
  // remembered row-relative offset so the reader lands where they were, not just at the row start.
  useEffect(() => {
    const directive = snapshot.restorationDirective;
    if (!directive || appliedRestorationRevisionRef.current === directive.revision) {
      return;
    }
    const index = findDirectiveIndex(layoutItems, directive);
    if (index === undefined) {
      return;
    }
    virtualizer.scrollToIndex(index, { align: "start" });
    if (directive.rowOffset !== 0) {
      window.scrollBy(0, -directive.rowOffset);
    }
    appliedRestorationRevisionRef.current = directive.revision;
    pendingAckRevisionRef.current = directive.revision;
    // Programmatic correction; not a User gesture.
    userScrolledRef.current = false;
  }, [snapshot.restorationDirective, layoutItems, virtualizer]);

  useEffect(() => {
    if (containerWidth === undefined || containerWidth <= 0) {
      return;
    }
    const firstVirtualItem = virtualItems[0];
    const scrollOrigin: "user" | "programmatic" | "initial" = userScrolledRef.current
      ? "user"
      : hasSentObservationRef.current
        ? "programmatic"
        : "initial";
    browsingWindow.intents.observeViewport({
      containerWidth,
      ...(actualRange ? { visibleItemRange: actualRange } : {}),
      ...(firstVirtualItem ? { visibleItemTopOffset: firstVirtualItem.start - (virtualizer.scrollOffset ?? 0) } : {}),
      viewportExtent: window.innerHeight,
      ...(focusedItemIndex !== undefined ? { focusedItemIndex } : {}),
      scrollOrigin,
      ...(pendingAckRevisionRef.current !== undefined ? { appliedRestorationRevision: pendingAckRevisionRef.current } : {}),
    });
    hasSentObservationRef.current = true;
    pendingAckRevisionRef.current = undefined;
    userScrolledRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsingWindow, containerWidth, visibleRangeKey, focusedItemIndex]);

  useEffect(() => {
    const firstRowItem = actualRange ? layoutItems[actualRange.startIndex] : undefined;
    if (!firstRowItem) {
      return;
    }
    if (firstRowItem.periodKey === currentPeriodKey) {
      return;
    }
    setCurrentPeriodKey(firstRowItem.periodKey);
    onVisiblePeriodChange?.(firstRowItem.periodKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRangeKey]);

  const onFocusCapture = (event: React.FocusEvent<HTMLDivElement>): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    const index = target?.dataset.index !== undefined ? Number(target.dataset.index) : undefined;
    setFocusedItemIndex(index);
  };

  const onBlurCapture = (event: React.FocusEvent<HTMLDivElement>): void => {
    const nextFocusTarget = event.relatedTarget as Node | null;
    if (!nextFocusTarget || !containerRef.current?.contains(nextFocusTarget)) {
      setFocusedItemIndex(undefined);
    }
  };

  // The container element stays mounted across every state branch below (never conditionally
  // omitted): the ResizeObserver above is set up once per component instance, and React reuses
  // this exact instance across different history entries/collections whenever they land at the
  // same position in the route tree, so an element that disappears in one state would silently
  // orphan the observer for every later Browsing Window this instance ever renders.
  return (
    <div onBlurCapture={onBlurCapture} onFocusCapture={onFocusCapture} ref={containerRef}>
      {snapshot.state === "empty" ? (
        <PrismaticEmptyState action={emptyState.action} description={emptyState.description} title={emptyState.title} variant={sourceCollection === "active" ? "album" : "archive"} />
      ) : snapshot.state === "loading" ? (
        // The very first page hasn't landed yet, so there's no real layout to virtualize -- a
        // static neutral placeholder fills that space instead of leaving it blank (design doc
        // "Thumbnail Loading": "a static neutral placeholder ... no shimmer").
        <InitialLoadingPlaceholder />
      ) : snapshot.state === "initial-failure" ? (
        <p className="mt-4 flex items-center justify-between gap-3 rounded-md border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
          <span>Couldn&apos;t load photos.</span>
          <button className="underline" onClick={() => browsingWindow.intents.retry()} type="button">
            Retry
          </button>
        </p>
      ) : (
        <>
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
                        actualRange === null || (virtualItem.index >= actualRange.startIndex && virtualItem.index <= actualRange.endIndex)
                      }
                      item={item}
                      location={location}
                      photoHrefFor={photoHrefFor}
                      sourceCollection={sourceCollection}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {snapshot.state === "tail-failure" ? (
            <p className="mt-4 flex items-center justify-between gap-3 rounded-md border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
              <span>Couldn&apos;t load more photos.</span>
              <button className="underline" onClick={() => browsingWindow.intents.retry()} type="button">
                Retry
              </button>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

const PLACEHOLDER_ROWS = [
  [2, 1, 3, 1],
  [1, 1, 1, 2],
];

/** Decorative only (`aria-hidden`): behaviour and copy are unchanged, this only replaces the
 * blank space that used to precede the first real row while loading. */
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
  sourceCollection,
}: {
  browsingWindow: BrowsingWindow;
  firstRowInView: boolean;
  inVisibleRange: boolean;
  item: BrowsingRow;
  location: ReturnType<typeof useLocation>;
  photoHrefFor: (photoId: string) => string;
  sourceCollection: PhotoCollection;
}) {
  return (
    <div className="flex" style={{ gap: SPACING, height: item.height }}>
      {item.cells.map((cell) => {
        // A withheld Photo (membership change) keeps its row slot's exact geometry but renders nothing (ADR-0067).
        if (cell.presentation.kind === "withheld") {
          return <span key={cell.photoId} style={{ height: item.height, width: cell.width }} />;
        }
        return (
          <PhotoLink
            browsingWindow={browsingWindow}
            cell={cell}
            fetchPriority={firstRowInView ? "high" : "auto"}
            height={item.height}
            key={cell.photoId}
            loading={inVisibleRange ? "eager" : "lazy"}
            location={location}
            sourceCollection={sourceCollection}
            to={photoHrefFor(cell.photoId)}
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
  cell,
  fetchPriority,
  height,
  loading,
  location,
  sourceCollection,
  to,
}: {
  browsingWindow: BrowsingWindow;
  cell: RenderReadyCell;
  fetchPriority: "high" | "auto";
  height: number;
  loading: "eager" | "lazy";
  location: ReturnType<typeof useLocation>;
  sourceCollection: PhotoCollection;
  to: string;
}) {
  const isOpeningViewer = useViewTransitionState(to);
  return (
    <Link
      aria-label={photoLinkName(cell.fileName, cell.capturedAt)}
      className="timeline-photo-link"
      state={{
        background: location,
        sequencePosition: cell.sequencePosition,
        sourceCollection,
      }}
      style={{ height, width: cell.width }}
      to={to}
      viewTransition
    >
      <span className="timeline-photo-thumb-wrap">
        {cell.presentation.kind === "ready" ? (
          <TimelineThumbnailImage
            fetchPriority={fetchPriority}
            height={height}
            leaseRevision={cell.presentation.leaseRevision}
            loading={loading}
            onOutcome={browsingWindow.intents.reportThumbnailOutcome}
            photoId={cell.photoId}
            sources={cell.presentation.sources}
            width={cell.width}
            {...(isOpeningViewer ? { viewTransitionName: PHOTO_VIEW_TRANSITION_NAME } : {})}
          />
        ) : (
          <span aria-hidden="true" className="block h-full w-full bg-table-glow" style={{ height, width: cell.width }} />
        )}
      </span>
      <span aria-hidden="true" className="timeline-photo-overlay">
        {formatCapturedAt(cell.capturedAt, "compact")}
      </span>
    </Link>
  );
}

const estimateItemSize = (item: BrowsingLayoutItem | undefined): number => {
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

const findDirectiveIndex = (
  layoutItems: BrowsingLayoutItem[],
  directive: { kind: "photo" | "period"; photoId?: string; periodKey?: string },
): number | undefined => {
  if (directive.kind === "period") {
    const index = layoutItems.findIndex((item) => item.kind === "month-marker" && item.periodKey === directive.periodKey);
    return index === -1 ? undefined : index;
  }
  const index = layoutItems.findIndex((item) => item.kind === "row" && item.cells.some((cell) => cell.photoId === directive.photoId));
  return index === -1 ? undefined : index;
};
