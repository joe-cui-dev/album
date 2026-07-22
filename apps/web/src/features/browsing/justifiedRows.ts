/** One loaded Photo's layout-relevant facts; a stable position in a Browsing Window's compact descriptor list. */
export interface PhotoLayoutDescriptor {
  photoId: string;
  /** width / height from stored dimensions. */
  aspectRatio: number;
  /** "YYYY-MM" for a known month, or "YYYY-unknown" for that year's Date Unknown group. */
  periodKey: string;
}

export interface MonthMarkerItem {
  kind: "month-marker";
  periodKey: string;
}

export interface JustifiedRowItem {
  kind: "row";
  periodKey: string;
  photoIds: string[];
  /** Row height in pixels; every item in the row shares it. */
  height: number;
  /** Per-photo widths in pixels, aligned by index with `photoIds`. */
  itemWidths: number[];
}

export type JustifiedLayoutItem = MonthMarkerItem | JustifiedRowItem;

export interface JustifiedRowsOptions {
  containerWidth: number;
  spacing: number;
  targetRowHeight: number;
  /**
   * True while the last period in `descriptors` could still receive more
   * Photos (an open cursor, or a withheld page-boundary tail). False once
   * that period is known complete, the collection ends, or incremental
   * loading fails — relaxing its tail into a visible final row.
   */
  hasMore: boolean;
}

export interface JustifiedRowsResult {
  /** Month markers and completed rows, in descriptor order. Never includes a withheld tail. */
  items: JustifiedLayoutItem[];
  /** The last period's withheld tail, when `hasMore` and it doesn't yet fill a row. */
  incompleteTailPhotoIds?: string[];
}

/**
 * Groups descriptors by contiguous period and packs each group's Photos into
 * justified rows from container width, spacing, target height, and stored
 * aspect ratio. Rows never crop a Photo or cross a period boundary. Every
 * period but the last is already known complete (a later period followed
 * it), so its short final row is always relaxed into view; the last period's
 * short tail is withheld unless the caller reports nothing more can arrive.
 */
export const computeJustifiedRows = (
  descriptors: PhotoLayoutDescriptor[],
  options: JustifiedRowsOptions,
): JustifiedRowsResult => {
  const groups = groupByPeriod(descriptors);
  const items: JustifiedLayoutItem[] = [];
  let incompleteTailPhotoIds: string[] | undefined;

  groups.forEach((group, groupIndex) => {
    const isLastGroup = groupIndex === groups.length - 1;
    items.push({ kind: "month-marker", periodKey: group.periodKey });

    const { rows, tail } = packRows(group.descriptors, options);
    items.push(...rows);

    if (tail.length === 0) {
      return;
    }
    if (isLastGroup && options.hasMore) {
      incompleteTailPhotoIds = tail.map((descriptor) => descriptor.photoId);
      return;
    }
    items.push(relaxedRow(group.periodKey, tail, options));
  });

  return { items, ...(incompleteTailPhotoIds ? { incompleteTailPhotoIds } : {}) };
};

interface PeriodGroup {
  periodKey: string;
  descriptors: PhotoLayoutDescriptor[];
}

const groupByPeriod = (descriptors: PhotoLayoutDescriptor[]): PeriodGroup[] => {
  const groups: PeriodGroup[] = [];
  for (const descriptor of descriptors) {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.periodKey === descriptor.periodKey) {
      currentGroup.descriptors.push(descriptor);
    } else {
      groups.push({ periodKey: descriptor.periodKey, descriptors: [descriptor] });
    }
  }
  return groups;
};

const packRows = (
  descriptors: PhotoLayoutDescriptor[],
  { containerWidth, spacing, targetRowHeight }: JustifiedRowsOptions,
): { rows: JustifiedRowItem[]; tail: PhotoLayoutDescriptor[] } => {
  const rows: JustifiedRowItem[] = [];
  let pending: PhotoLayoutDescriptor[] = [];
  let aspectRatioSum = 0;

  for (const descriptor of descriptors) {
    pending.push(descriptor);
    aspectRatioSum += descriptor.aspectRatio;
    const widthAtTargetHeight = aspectRatioSum * targetRowHeight + spacing * (pending.length - 1);
    if (widthAtTargetHeight >= containerWidth) {
      rows.push(justifiedRow(pending, aspectRatioSum, { containerWidth, spacing }));
      pending = [];
      aspectRatioSum = 0;
    }
  }

  return { rows, tail: pending };
};

const justifiedRow = (
  descriptors: PhotoLayoutDescriptor[],
  aspectRatioSum: number,
  { containerWidth, spacing }: { containerWidth: number; spacing: number },
): JustifiedRowItem => {
  const height = (containerWidth - spacing * (descriptors.length - 1)) / aspectRatioSum;
  return {
    kind: "row",
    periodKey: descriptors[0]!.periodKey,
    photoIds: descriptors.map((descriptor) => descriptor.photoId),
    height,
    itemWidths: descriptors.map((descriptor) => descriptor.aspectRatio * height),
  };
};

/** A known-complete period's short final row: laid out at target height, never stretched to fill the container. */
const relaxedRow = (
  periodKey: string,
  descriptors: PhotoLayoutDescriptor[],
  { targetRowHeight }: JustifiedRowsOptions,
): JustifiedRowItem => ({
  kind: "row",
  periodKey,
  photoIds: descriptors.map((descriptor) => descriptor.photoId),
  height: targetRowHeight,
  itemWidths: descriptors.map((descriptor) => descriptor.aspectRatio * targetRowHeight),
});

export interface IncrementalJustifiedRows {
  /** Appends the descriptors loaded since the previous call and returns the up-to-date result. */
  append(newDescriptors: PhotoLayoutDescriptor[], options: JustifiedRowsOptions): JustifiedRowsResult;
  /** Recomputes from scratch, e.g. after a container resize invalidates every cached row's geometry. */
  reset(allDescriptors: PhotoLayoutDescriptor[], options: JustifiedRowsOptions): JustifiedRowsResult;
}

/**
 * A stateful wrapper around `computeJustifiedRows` for a descriptor list that only ever grows by
 * appending. Once a period is known-complete (a later period's descriptor has since arrived,
 * proven by contiguity) its rows are packed once and cached forever; only the still-open final
 * period's small remainder is ever recomputed. `computeJustifiedRows` itself is O(total loaded
 * descriptors) per call, so calling it on every incremental page load over a large collection
 * costs O(descriptors²) across a full scroll session -- this keeps each call's cost bounded by
 * the newly-arrived slice instead.
 *
 * A `loadError` (as opposed to genuine exhaustion) relaxes the open tail into a visible row only
 * provisionally: retrying can still extend that same period, so error-driven relaxation is never
 * folded into the permanent cache -- only a proven later period, or true exhaustion, settles it.
 */
export const createIncrementalJustifiedRows = (): IncrementalJustifiedRows => {
  let settledItems: JustifiedLayoutItem[] = [];
  let openGroupDescriptors: PhotoLayoutDescriptor[] = [];

  const computeOpenGroup = (options: JustifiedRowsOptions): JustifiedRowsResult => {
    if (openGroupDescriptors.length === 0) {
      return { items: [] };
    }
    const items: JustifiedLayoutItem[] = [{ kind: "month-marker", periodKey: openGroupDescriptors[0]!.periodKey }];
    const { rows, tail } = packRows(openGroupDescriptors, options);
    items.push(...rows);
    if (tail.length === 0) {
      return { items };
    }
    if (options.hasMore) {
      return { items, incompleteTailPhotoIds: tail.map((descriptor) => descriptor.photoId) };
    }
    items.push(relaxedRow(openGroupDescriptors[0]!.periodKey, tail, options));
    return { items };
  };

  const append = (newDescriptors: PhotoLayoutDescriptor[], options: JustifiedRowsOptions): JustifiedRowsResult => {
    openGroupDescriptors = [...openGroupDescriptors, ...newDescriptors];
    const groups = groupByPeriod(openGroupDescriptors);
    if (groups.length > 1) {
      // A later period has definitely arrived, so every earlier group here is permanently done.
      for (const group of groups.slice(0, -1)) {
        settledItems.push({ kind: "month-marker", periodKey: group.periodKey });
        const { rows, tail } = packRows(group.descriptors, options);
        settledItems.push(...rows);
        if (tail.length > 0) {
          settledItems.push(relaxedRow(group.periodKey, tail, options));
        }
      }
      openGroupDescriptors = groups[groups.length - 1]!.descriptors;
    }
    const openResult = computeOpenGroup(options);
    return {
      items: [...settledItems, ...openResult.items],
      ...(openResult.incompleteTailPhotoIds ? { incompleteTailPhotoIds: openResult.incompleteTailPhotoIds } : {}),
    };
  };

  return {
    append,
    reset: (allDescriptors, options) => {
      settledItems = [];
      openGroupDescriptors = [];
      return append(allDescriptors, options);
    },
  };
};
