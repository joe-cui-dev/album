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
