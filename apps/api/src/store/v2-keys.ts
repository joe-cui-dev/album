import { buildChronologyKey, getCapturedAtComponents, type CapturedAt } from "@album/shared";

export type PhotoCollection = "active" | "archived";

const collectionSegment = (collection: PhotoCollection): "ACTIVE" | "ARCHIVED" =>
  collection === "active" ? "ACTIVE" : "ARCHIVED";

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
  `TIMELINE_V2#${collectionSegment(collection)}#${buildChronologyKey(capturedAt)}#${addedAt}#${photoId}`;

/** SK for the per-year Date Index counter item of one collection. */
export const dateIndexSortKey = ({
  collection,
  year,
}: {
  collection: PhotoCollection;
  year: number;
}): string => `DATE_INDEX_V2#${collectionSegment(collection)}#${String(year).padStart(4, "0")}`;

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
