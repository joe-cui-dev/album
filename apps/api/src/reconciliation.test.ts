import { reconcilePhase2Records } from "./reconciliation.js";
import { createInMemoryPhotoObjectStore } from "./store/in-memory-photo-object-store.js";
import { reconcileThumbnailObjects } from "./reconciliation.js";

describe("reconcilePhase2Records", () => {
  it("reports projection, Date Index, Issue, and legacy-state discrepancies", () => {
    const report = reconcilePhase2Records([
      { pk: "USER#user-1", sk: "PHOTO#ready", userId: "user-1", photoId: "ready", processingState: "ready", archived: false },
      { pk: "USER#user-1", sk: "PHOTO#failed", userId: "user-1", photoId: "failed", processingState: "processingFailed" },
      { pk: "USER#user-1", sk: "PHOTO#legacy", userId: "user-1", photoId: "legacy", processingState: "uploaded" },
      { pk: "USER#user-1", sk: "PROCESSING_ISSUES#SUMMARY", userId: "user-1", openCount: 2 },
    ]);
    expect(report).toMatchObject({ readyPhotos: 1, processingFailedPhotos: 1, processingIssues: 0 });
    expect(report.discrepancies).toEqual(expect.arrayContaining([
      "Ready Photo is missing v2 migration state user-1/ready",
      "Processing Failed Photo has no Issue user-1/failed",
      "Unexpected legacy uploaded Photo user-1/legacy",
      "Processing Issue summary mismatch for user-1",
    ]));
  });

  it("accepts Date Index and Issue summary items that carry identity only in their partition key", () => {
    const report = reconcilePhase2Records([
      {
        pk: "USER#user-1", sk: "PHOTO#ready", userId: "user-1", photoId: "ready",
        processingState: "ready", archived: false, migrationVersion: 1,
        chronology: {
          original: { capturedAt: { precision: "day", localDate: "2024-06-15" }, source: "exif" },
          active: { capturedAt: { precision: "day", localDate: "2024-06-15" }, source: "exif", revision: 0 },
        },
        timelineThumbnails: { small: {}, large: {} },
      },
      { pk: "USER#user-1", sk: "TIMELINE_V2#ACTIVE#2024.06.15.--.--.--.------#undefined#ready", userId: "user-1", photoId: "ready" },
      { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2024", "06": 1 },
      { pk: "USER#user-1", sk: "PROCESSING_ISSUE#x", userId: "user-1", photoId: "failed" },
      { pk: "USER#user-1", sk: "PROCESSING_ISSUES#SUMMARY", openCount: 1 },
    ]);
    expect(report.discrepancies).toEqual([]);
  });

  it("reports missing physical Thumbnail variants", async () => {
    const objects = createInMemoryPhotoObjectStore();
    await expect(reconcileThumbnailObjects([
      {
        sk: "PHOTO#ready", userId: "user-1", photoId: "ready", processingState: "ready",
        timelineThumbnails: { small: { objectKey: "small.jpg" }, large: { objectKey: "large.jpg" } },
      },
    ], objects)).resolves.toEqual([
      "Missing Small Thumbnail object user-1/ready",
      "Missing Large Thumbnail object user-1/ready",
    ]);
  });
});
