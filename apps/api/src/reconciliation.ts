import { getCapturedAtComponents, type Photo } from "@album/shared";
import { dateIndexPeriodSegment, timelineProjectionSortKey } from "./store/v2-keys.js";
import type { PhotoObjectStore } from "./store/photo-objects.js";

export interface ReconciliationReport {
  readyPhotos: number;
  processingFailedPhotos: number;
  processingIssues: number;
  discrepancies: string[];
}

/** Pure reconciliation of the DynamoDB write model and all v2 projections. */
export const reconcilePhase2Records = (
  records: Array<Record<string, unknown>>,
): ReconciliationReport => {
  const photos = records.filter((item) => String(item.sk).startsWith("PHOTO#")) as unknown as Photo[];
  const projections = records.filter((item) => String(item.sk).startsWith("TIMELINE_V2#"));
  const issues = records.filter((item) => String(item.sk).startsWith("PROCESSING_ISSUE#"));
  const summaries = records.filter((item) => item.sk === "PROCESSING_ISSUES#SUMMARY");
  const discrepancies: string[] = [];
  const userIdOf = (item: Record<string, unknown>): string | undefined =>
    typeof item.userId === "string"
      ? item.userId
      : typeof item.pk === "string" && item.pk.startsWith("USER#")
        ? item.pk.slice("USER#".length)
        : undefined;
  const projectionCount = new Map<string, number>();
  for (const projection of projections) {
    if (typeof projection.userId !== "string" || typeof projection.photoId !== "string") {
      discrepancies.push(`Malformed Timeline projection ${String(projection.sk)}`);
      continue;
    }
    const key = `${projection.userId}/${projection.photoId}`;
    projectionCount.set(key, (projectionCount.get(key) ?? 0) + 1);
  }
  const expectedIndex = new Map<string, number>();
  for (const photo of photos) {
    const key = `${photo.userId}/${photo.photoId}`;
    if (String(photo.processingState) === "uploaded") {
      discrepancies.push(`Unexpected legacy uploaded Photo ${key}`);
    }
    if (photo.processingState !== "ready") {
      if (projectionCount.has(key)) discrepancies.push(`Non-Ready Photo has a projection ${key}`);
      continue;
    }
    if (!photo.chronology || !photo.timelineThumbnails || (photo.migrationVersion ?? 0) < 1) {
      discrepancies.push(`Ready Photo is missing v2 migration state ${key}`);
      continue;
    }
    if (projectionCount.get(key) !== 1) {
      discrepancies.push(`Ready Photo must have exactly one projection ${key}`);
    }
    const active = photo.archived ? "ARCHIVED" : "ACTIVE";
    const components = getCapturedAtComponents(photo.chronology.active.capturedAt);
    const indexKey = `${photo.userId}/${active}/${components.year}/${dateIndexPeriodSegment(photo.chronology.active.capturedAt)}`;
    expectedIndex.set(indexKey, (expectedIndex.get(indexKey) ?? 0) + 1);
  }
  for (const projection of projections) {
    const userId = userIdOf(projection);
    if (!userId || typeof projection.photoId !== "string") continue;
    const photo = photos.find((candidate) => candidate.userId === userId && candidate.photoId === projection.photoId);
    if (!photo?.chronology || !photo.uploadRequestedAt || photo.processingState !== "ready") continue;
    const collection = photo.archived ? "archived" : "active";
    const expectedKey = timelineProjectionSortKey({
      collection,
      capturedAt: photo.chronology.active.capturedAt,
      addedAt: photo.uploadRequestedAt,
      photoId: photo.photoId,
    });
    if (projection.sk !== expectedKey) {
      discrepancies.push(`Incorrect Timeline projection ${userId}/${photo.photoId}`);
    }
  }
  const actualIndex = new Map<string, number>();
  for (const item of records.filter((entry) => String(entry.sk).startsWith("DATE_INDEX_V2#"))) {
    const [, collection, year] = String(item.sk).split("#");
    const userId = userIdOf(item);
    if (!userId || !collection || !year) continue;
    for (const period of [...Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")), "unknown"]) {
      const count = item[period];
      if (typeof count === "number" && count > 0) {
        actualIndex.set(`${userId}/${collection}/${Number(year)}/${period}`, count);
      }
    }
  }
  for (const key of new Set([...expectedIndex.keys(), ...actualIndex.keys()])) {
    if (expectedIndex.get(key) !== actualIndex.get(key)) {
      discrepancies.push(`Date Index mismatch ${key}: expected ${expectedIndex.get(key) ?? 0}, found ${actualIndex.get(key) ?? 0}`);
    }
  }
  const issuesByUser = new Map<string, number>();
  for (const issue of issues) {
    const userId = userIdOf(issue);
    if (userId) issuesByUser.set(userId, (issuesByUser.get(userId) ?? 0) + 1);
  }
  const summariesByUser = new Map<string, number>();
  for (const summary of summaries) {
    const userId = userIdOf(summary);
    if (userId) summariesByUser.set(userId, typeof summary.openCount === "number" ? summary.openCount : 0);
  }
  for (const userId of new Set([...issuesByUser.keys(), ...summariesByUser.keys()])) {
    if ((summariesByUser.get(userId) ?? 0) !== (issuesByUser.get(userId) ?? 0)) {
      discrepancies.push(`Processing Issue summary mismatch for ${userId}`);
    }
  }
  for (const photo of photos.filter((candidate) => candidate.processingState === "processingFailed")) {
    if (!issues.some((issue) => issue.userId === photo.userId && issue.photoId === photo.photoId)) {
      discrepancies.push(`Processing Failed Photo has no Issue ${photo.userId}/${photo.photoId}`);
    }
  }
  return {
    readyPhotos: photos.filter((photo) => photo.processingState === "ready").length,
    processingFailedPhotos: photos.filter((photo) => photo.processingState === "processingFailed").length,
    processingIssues: issues.length,
    discrepancies,
  };
};

/** Reads both private Thumbnail objects for every migrated Ready Photo. */
export const reconcileThumbnailObjects = async (
  records: Array<Record<string, unknown>>,
  photoObjects: PhotoObjectStore,
): Promise<string[]> => {
  const photos = records.filter((item) => String(item.sk).startsWith("PHOTO#")) as unknown as Photo[];
  const discrepancies: string[] = [];
  await Promise.all(photos.filter((photo) => photo.processingState === "ready" && photo.timelineThumbnails)
    .flatMap((photo) => [
      { photo, variant: "Small", objectKey: photo.timelineThumbnails!.small.objectKey },
      { photo, variant: "Large", objectKey: photo.timelineThumbnails!.large.objectKey },
    ])
    .map(async ({ photo, variant, objectKey }) => {
      try {
        if (!await photoObjects.objectExists(objectKey)) throw new Error("Missing object");
      } catch {
        discrepancies.push(`Missing ${variant} Thumbnail object ${photo.userId}/${photo.photoId}`);
      }
    }));
  return discrepancies;
};
