import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleGetUploadBatchStatus } from "./upload-batch-status.js";

describe("handleGetUploadBatchStatus", () => {
  it("returns counts and lightweight per-photo status for the signed-in user's batch", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const createPhoto = (photoId: string, fileName: string) => album.createPhoto({ photoId, uploadBatchId: "batch-1", originalObjectKey: `originals/user-1/batch-1/${photoId}`, fileName, format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 42, uploadRequestedAt: "2026-05-26T01:02:03.000Z" });
    await createPhoto("photo-1", "ready.jpg");
    await createPhoto("photo-2", "duplicate.jpg");
    await createPhoto("photo-3", "broken.heic");
    await album.createUploadBatch({ uploadBatchId: "batch-1", createdAt: "2026-05-26T01:02:03.000Z", photoIds: ["photo-1", "photo-2", "photo-3"] });
    await album.markReady({ photoId: "photo-1", sha256: "ready", fileName: "ready.jpg", displayObjectKey: "display/user-1/photo-1.jpg", displayDimensions: { width: 1, height: 1 }, timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg", timelineThumbnailDimensions: { width: 1, height: 1 }, capturedAt: "2026-05-26T01:02:03.000Z", capturedAtSource: "exif", metadata: {} });
    await album.markExactDuplicate({ photoId: "photo-2", sha256: "duplicate", duplicateOfPhotoId: "photo-1" });
    await album.markProcessingFailed({ photoId: "photo-3", failureCode: "unsupportedImage", failureMessage: "We couldn't process this photo." });

    const response = await handleGetUploadBatchStatus({ user: { userId: "user-1", email: "user@example.com" }, album, uploadBatchId: "batch-1" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body).toEqual({
      uploadBatchId: "batch-1",
      counts: { uploadRequested: 0, processing: 0, ready: 1, processingFailed: 1, exactDuplicate: 1 },
      photos: [
        { photoId: "photo-1", fileName: "ready.jpg", processingState: "ready", exactDuplicate: false },
        { photoId: "photo-2", fileName: "duplicate.jpg", processingState: "exactDuplicate", exactDuplicate: true, duplicateOfPhotoId: "photo-1" },
        { photoId: "photo-3", fileName: "broken.heic", processingState: "processingFailed", exactDuplicate: false, failureCode: "unsupportedImage", failureMessage: "We couldn't process this photo." },
      ],
    });
    expect(JSON.stringify(body).includes("originalObjectKey")).toBe(false);
    expect(JSON.stringify(body).includes("displayObjectKey")).toBe(false);
  });

  it("includes timelineAnchor for a v2 Ready photo and duplicateOfPhotoId for an Exact Duplicate", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const createPhoto = (photoId: string, fileName: string) => album.createPhoto({ photoId, uploadBatchId: "batch-1", originalObjectKey: `originals/user-1/batch-1/${photoId}`, fileName, format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 42, uploadRequestedAt: "2026-05-26T01:02:03.000Z" });
    await createPhoto("photo-1", "ready.jpg");
    await createPhoto("photo-2", "duplicate.jpg");
    await album.createUploadBatch({ uploadBatchId: "batch-1", createdAt: "2026-05-26T01:02:03.000Z", photoIds: ["photo-1", "photo-2"] });
    await album.publishReadyPhotoV2({
      photoId: "photo-1",
      fileName: "ready.jpg",
      sha256: "ready",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: { width: 1, height: 1 },
      timelineThumbnails: { small: { objectKey: "s.jpg", dimensions: { width: 1, height: 1 } }, large: { objectKey: "l.jpg", dimensions: { width: 1, height: 1 } } },
      metadata: {},
      originalCapturedAt: { precision: "month", localDate: "2026-03" },
      originalCapturedAtSource: "exif",
      hadOpenProcessingIssue: false,
    });
    await album.markExactDuplicate({ photoId: "photo-2", sha256: "duplicate", duplicateOfPhotoId: "photo-1" });

    const response = await handleGetUploadBatchStatus({ user: { userId: "user-1", email: "user@example.com" }, album, uploadBatchId: "batch-1" });
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photos).toEqual([
      { photoId: "photo-1", fileName: "ready.jpg", processingState: "ready", exactDuplicate: false, timelineAnchor: "2026-03" },
      { photoId: "photo-2", fileName: "duplicate.jpg", processingState: "exactDuplicate", exactDuplicate: true, duplicateOfPhotoId: "photo-1" },
    ]);
  });
});
