import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link, useLocation } from "react-router";
import type { PhotoCollection } from "@album/shared";
import { formatCapturedAt, photoLinkName } from "../../lib/capturedAtFormat.js";
import { BROWSING_ROW_SPACING, BROWSING_TARGET_ROW_HEIGHT } from "./browsingLayoutConstants.js";
import type { BrowsingWindow, RestorationAnchor } from "./browsingWindow.js";
import type { JustifiedLayoutItem } from "./justifiedRows.js";
import { TimelineThumbnailImage } from "./TimelineThumbnailImage.js";
import { useBrowsingWindowSnapshot } from "./useBrowsingWindow.js";

const SPACING = BROWSING_ROW_SPACING;
const TARGET_ROW_HEIGHT = BROWSING_TARGET_ROW_HEIGHT;
const MONTH_MARKER_HEIGHT = 40;
const LOAD_MORE_THRESHOLD_ITEMS = 6;
const RENEWAL_POLL_MS = 20_000;

interface BrowsingGridProps {
  browsingWindow: BrowsingWindow;
  photoHrefFor: (photoId: string) => string;
  emptyState: { title: string; description: string; action?: ReactNode };
  sourceCollection: PhotoCollection;
  /** Fires as the topmost visible period changes, for the date navigation's active styling only. */
  onVisiblePeriodChange?: (periodKey: string) => void;
}

/** ADR-0064: TanStack Virtual with window scrolling, driven entirely by the Browsing Window's own snapshot. */
export function BrowsingGrid({
  browsingWindow,
  photoHrefFor,
  emptyState,
  sourceCollection,
  onVisiblePeriodChange,
}: BrowsingGridProps) {
  const snapshot = useBrowsingWindowSnapshot(browsingWindow);
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  const hasRestoredRef = useRef(false);

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
                <MonthMarker periodKey={item.periodKey} />
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

function MonthMarker({ periodKey }: { periodKey: string }) {
  return (
    <h2
      className="sticky top-0 z-10 flex h-10 items-end border-b border-line bg-print-white/90 px-1 pb-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-ink-muted backdrop-blur"
      style={{ height: MONTH_MARKER_HEIGHT }}
    >
      {labelForPeriodKey(periodKey)}
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
          <Link
            aria-label={photoLinkName(descriptor.fileName, descriptor.capturedAt)}
            className="block overflow-hidden rounded-sm bg-table-glow ring-1 ring-line shadow-sm transition-shadow duration-150 hover:shadow-md hover:ring-control-line focus:outline-none focus:ring-2 focus:ring-emulsion"
            key={photoId}
            state={{
              background: location,
              sequencePosition: browsingWindow.getSequencePosition(photoId),
              sourceCollection,
            }}
            style={{ height: item.height, width }}
            to={photoHrefFor(photoId)}
          >
            <TimelineThumbnailImage
              fetchPriority={firstRowInView ? "high" : "auto"}
              height={item.height}
              loading={inVisibleRange ? "eager" : "lazy"}
              sources={descriptor.timelineThumbnailSources}
              width={width}
            />
          </Link>
        );
      })}
    </div>
  );
}

const estimateItemSize = (item: JustifiedLayoutItem | undefined): number => {
  if (!item) {
    return TARGET_ROW_HEIGHT;
  }
  return item.kind === "month-marker" ? MONTH_MARKER_HEIGHT : item.height + SPACING;
};

const labelForPeriodKey = (periodKey: string): string => {
  const [yearPart, monthPart] = periodKey.split("-") as [string, string];
  if (monthPart === "unknown") {
    return `${yearPart} · Date unknown`;
  }
  return formatCapturedAt(
    { precision: "month", localDate: periodKey },
    "accessible",
  );
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
