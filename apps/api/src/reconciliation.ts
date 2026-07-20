import { getCapturedAtComponents, type Photo } from "@album/shared";
import { dateIndexPeriodSegment } from "./store/v2-keys.js";

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
  const actualIndex = new Map<string, number>();
  for (const item of records.filter((entry) => String(entry.sk).startsWith("DATE_INDEX_V2#"))) {
    const [, collection, year] = String(item.sk).split("#");
    if (typeof item.userId !== "string" || !collection || !year) continue;
    for (const period of [...Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")), "unknown"]) {
      const count = item[period];
      if (typeof count === "number" && count > 0) {
        actualIndex.set(`${item.userId}/${collection}/${Number(year)}/${period}`, count);
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
    if (typeof issue.userId === "string") issuesByUser.set(issue.userId, (issuesByUser.get(issue.userId) ?? 0) + 1);
  }
  for (const summary of summaries) {
    if (typeof summary.userId !== "string") continue;
    if ((summary.openCount ?? 0) !== (issuesByUser.get(summary.userId) ?? 0)) {
      discrepancies.push(`Processing Issue summary mismatch for ${summary.userId}`);
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
