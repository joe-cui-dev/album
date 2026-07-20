import { runMaintenanceCoordinator } from "./maintenance-coordinator.js";

describe("runMaintenanceCoordinator", () => {
  it("dry run emits a migration manifest without enqueuing any writes", async () => {
    const enqueue = jest.fn(async () => undefined);
    async function* records() {
      yield { userId: "user-1", photoId: "legacy-ready", processingState: "ready" };
      yield { userId: "user-1", photoId: "already-migrated", processingState: "ready", migrationVersion: 1 };
      yield { userId: "user-1", photoId: "legacy-failure", processingState: "processingFailed" };
    }
    await expect(runMaintenanceCoordinator(
      { dryRun: true },
      { scanPhotoRecords: records, enqueue, now: () => new Date("2026-07-20T00:00:00.000Z") },
    )).resolves.toMatchObject({
      dryRun: true,
      migrationVersion: 1,
      queued: 2,
      readyPhotos: 2,
      failedPhotos: 1,
      legacyFallbackTimeZone: "Australia/Brisbane",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
