import { buildChronologyKey, getCapturedAtComponents, type CapturedAt } from "@album/shared";

export type PhotoCollection = "active" | "archived";

const collectionSegment = (collection: PhotoCollection): "ACTIVE" | "ARCHIVED" =>
  collection === "active" ? "ACTIVE" : "ARCHIVED";

/** Bare SK prefix for one collection's Timeline/Archive projections. */
export const timelineProjectionPrefix = (collection: PhotoCollection): string =>
  `TIMELINE_V2#${collectionSegment(collection)}#`;

/** SK for the lightweight Timeline/Archive projection of one Ready Photo. */
export const timelineProjectionSortKey = ({
  collection,
  capturedAt,
  addedAt,
  photoId,
}: {
  collection: PhotoCollection;
  capturedAt: CapturedAt;
  addedAt: string;
  photoId: string;
}): string =>
  `${timelineProjectionPrefix(collection)}${buildChronologyKey(capturedAt)}#${addedAt}#${photoId}`;

/**
 * Inclusive upper-bound SK for every projection at or older than the top of
 * a `startAt` period (a known YYYY-MM, or the year's Date Unknown group).
 * Paired with timelineProjectionPrefix as a BETWEEN lower bound, a
 * descending scan from this bound anchors a continuous older stream.
 */
export const timelinePeriodUpperBoundSortKey = (
  collection: PhotoCollection,
  period: { year: number; month?: number },
): string => {
  const chronologyUpperBound =
    period.month !== undefined
      ? `${String(period.year).padStart(4, "0")}.${String(period.month).padStart(2, "0")}.99.99.99.99.999999`
      : `${String(period.year).padStart(4, "0")}.--.--.--.--.--.------`;
  // "￿" sorts above any real Added At / Photo ID suffix at this exact chronology point.
  return `${timelineProjectionPrefix(collection)}${chronologyUpperBound}#￿`;
};

/** Parses a navigation anchor: "YYYY-MM" or "YYYY-unknown". */
export const parseStartAt = (
  value: string,
): { year: number; month?: number } | undefined => {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    return month >= 1 && month <= 12 ? { year, month } : undefined;
  }
  const unknownMatch = /^(\d{4})-unknown$/.exec(value);
  return unknownMatch ? { year: Number(unknownMatch[1]) } : undefined;
};

/** Bare SK prefix for one collection's Date Index year items. */
export const dateIndexPrefix = (collection: PhotoCollection): string =>
  `DATE_INDEX_V2#${collectionSegment(collection)}#`;

/** SK for the per-year Date Index counter item of one collection. */
export const dateIndexSortKey = ({
  collection,
  year,
}: {
  collection: PhotoCollection;
  year: number;
}): string => `${dateIndexPrefix(collection)}${String(year).padStart(4, "0")}`;

/**
 * Zero counters may remain stored (e.g. a DynamoDB ADD that reached zero
 * without removing the attribute) but are always omitted by the API.
 */
export const omitZeroCounts = <T extends Record<string, number>>(counts: T): T =>
  Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0)) as T;

/** Date Index counter attribute name within a year's item: "01"-"12" or "unknown". */
export const dateIndexPeriodSegment = (capturedAt: CapturedAt): string => {
  const { month } = getCapturedAtComponents(capturedAt);
  return month !== undefined ? String(month).padStart(2, "0") : "unknown";
};

export const dateIndexYear = (capturedAt: CapturedAt): number =>
  getCapturedAtComponents(capturedAt).year;

/** SK for one durable Processing Issue row. */
export const processingIssueSortKey = ({
  addedAt,
  photoId,
}: {
  addedAt: string;
  photoId: string;
}): string => `PROCESSING_ISSUE#${addedAt}#${photoId}`;

/** SK for the singleton item tracking the exact open Processing Issue count. */
export const PROCESSING_ISSUES_SUMMARY_SORT_KEY = "PROCESSING_ISSUES#SUMMARY";
