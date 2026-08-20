import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleGetAlbumNavigation } from "./album-navigation.js";

const user = { userId: "user-1", email: "user@example.com" };
const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "small.jpg", dimensions: { width: 320, height: 213 } },
  large: { objectKey: "large.jpg", dimensions: { width: 640, height: 427 } },
};
const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });

describe("handleGetAlbumNavigation", () => {
  it("returns non-empty Timeline and Trash year/month counts plus the exact open Processing Issue count", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");

    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
      uploadLocalDateTime: "2026-01-01T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.publishReadyPhoto({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      sha256: "hash",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: dimensions,
      timelineThumbnails: thumbnails,
      metadata: {},
      originalCapturedAt: day("2024-06-15"),
      originalCapturedAtSource: "exif",
      hadOpenProcessingIssue: false,
    });

    await album.createPhoto({
      photoId: "photo-2",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-2",
      fileName: "photo-2.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
      uploadLocalDateTime: "2026-01-01T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.recordProcessingIssue({
      photoId: "photo-2",
      fileName: "photo-2.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-01-01T00:01:00.000Z",
    });

    const response = await handleGetAlbumNavigation({ user, album });
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["cache-control"]).toBe("private, no-store");
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      timeline: { years: [{ year: 2024, counts: { "06": 1 } }] },
      trash: { years: [] },
      favourites: { years: [] },
      processingIssueCount: 1,
    });
  });

  it("returns empty navigation for a brand new album", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleGetAlbumNavigation({ user, album });
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      timeline: { years: [] },
      trash: { years: [] },
      favourites: { years: [] },
      processingIssueCount: 0,
    });
  });

  it("returns non-empty Favourites year/month counts", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
      uploadLocalDateTime: "2026-01-01T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.publishReadyPhoto({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      sha256: "hash",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: dimensions,
      timelineThumbnails: thumbnails,
      metadata: {},
      originalCapturedAt: day("2024-06-15"),
      originalCapturedAtSource: "exif",
      hadOpenProcessingIssue: false,
    });
    await album.setFavourite({ photoId: "photo-1", favourite: true });

    const response = await handleGetAlbumNavigation({ user, album });
    expect(JSON.parse(response.body ?? "{}").favourites).toEqual({ years: [{ year: 2024, counts: { "06": 1 } }] });
  });
});
