import { createInMemoryPersonalAlbumStore } from "./in-memory-store.js";

describe("PersonalAlbum contract", () => {
  it("round-trips a created Photo through its User's Personal Album", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");

    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "summer.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(await album.getPhoto("photo-1")).toMatchObject({
      photoId: "photo-1",
      userId: "user-1",
      processingState: "uploadRequested",
      archived: false,
    });
  });

  it("keeps state transitions, Timeline filtering, ranges, and Users independent", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const otherAlbum = store.personalAlbumOf("user-2");
    const create = (photoId: string) =>
      album.createPhoto({
        photoId,
        uploadBatchId: "batch-1",
        originalObjectKey: `originals/user-1/batch-1/${photoId}`,
        fileName: `${photoId}.jpg`,
        format: "jpeg",
        contentType: "image/jpeg",
        fileSizeBytes: 42,
        uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      });
    await create("old");
    await create("new");
    await album.markProcessingStarted("old");
    await album.markProcessingFailed({
      photoId: "old",
      failureCode: "unsupportedImage",
      failureMessage: "Couldn't process",
    });
    await album.markExactDuplicate({
      photoId: "old",
      sha256: "duplicate",
      duplicateOfPhotoId: "new",
    });
    for (const { photoId, capturedAt, sha256 } of [
      { photoId: "old", capturedAt: "2026-01-01T00:00:00.000Z", sha256: "old-hash" },
      { photoId: "new", capturedAt: "2026-01-02T00:00:00.000Z", sha256: "new-hash" },
    ]) {
      await album.markReady({
        photoId,
        sha256,
        fileName: `${photoId}.jpg`,
        displayObjectKey: `display/user-1/${photoId}.jpg`,
        displayDimensions: { width: 100, height: 50 },
        timelineThumbnailObjectKey: `timeline-thumbnails/user-1/${photoId}.jpg`,
        timelineThumbnailDimensions: { width: 50, height: 25 },
        capturedAt,
        capturedAtSource: "exif",
        metadata: {},
      });
    }
    await album.archivePhoto("old");

    await otherAlbum.createPhoto({
      photoId: "new",
      uploadBatchId: "batch-2",
      originalObjectKey: "originals/user-2/batch-2/new",
      fileName: "other.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 1,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
    });

    await expect(
      album.listTimelinePhotos({
        fromCapturedAt: "2026-01-01T00:00:00.000Z",
        toCapturedAt: "2026-01-02T00:00:00.000Z",
        processingState: "ready",
        archived: false,
      }),
    ).resolves.toMatchObject([{ photoId: "new" }]);
    await expect(album.getPhoto("new")).resolves.toMatchObject({ userId: "user-1" });
    await expect(otherAlbum.getPhoto("old")).resolves.toBeUndefined();
    await expect(
      album.findReadyPhotoBySha256({ sha256: "new-hash", excludePhotoId: "old" }),
    ).resolves.toEqual({ photoId: "new" });
    await expect(
      album.findReadyPhotoBySha256({ sha256: "new-hash", excludePhotoId: "new" }),
    ).resolves.toBeUndefined();
  });
});
