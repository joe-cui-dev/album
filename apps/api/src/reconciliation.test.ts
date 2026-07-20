import { reconcilePhase2Records } from "./reconciliation.js";

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
});
