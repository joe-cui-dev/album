import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import type { PersonalAlbum } from "../store/personal-album.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handleListTimelinePhotos } from "./list-timeline-photos.js";

const user = { userId: "user-1", email: "user@example.com" };
const withPresignDownload = (
  presignDownload: PhotoObjectStore["presignDownload"],
): PhotoObjectStore => ({ ...createInMemoryPhotoObjectStore(), presignDownload });
const createPhoto = (album: PersonalAlbum, photoId: string, fileName: string) =>
  album.createPhoto({ photoId, uploadBatchId: "batch-1", originalObjectKey: `originals/user-1/batch-1/${photoId}`, fileName, format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 42, uploadRequestedAt: "2026-05-26T01:02:03.000Z" });
const markReady = (album: PersonalAlbum, photoId: string, fileName: string, capturedAt: string) =>
  album.markReady({ photoId, sha256: photoId, fileName, displayObjectKey: `display/user-1/${photoId}.jpg`, displayDimensions: { width: 1600, height: 1200 }, timelineThumbnailObjectKey: `timeline-thumbnails/user-1/${photoId}.jpg`, timelineThumbnailDimensions: { width: 320, height: 240 }, capturedAt, capturedAtSource: "exif", metadata: {} });

describe("handleListTimelinePhotos", () => {
  it("returns the signed-in user's newest ready timeline photos and hides archived photos by default", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf(user.userId);
    await createPhoto(album, "photo-old", "old.jpg");
    await createPhoto(album, "photo-new", "new.jpg");
    await createPhoto(album, "photo-archived", "archived.jpg");
    await createPhoto(album, "photo-processing", "processing.jpg");
    await markReady(album, "photo-old", "old.jpg", "2024-12-31T23:00:00.000Z");
    await markReady(album, "photo-new", "new.jpg", "2025-01-02T10:00:00.000Z");
    await markReady(album, "photo-archived", "archived.jpg", "2025-01-03T10:00:00.000Z");
    await album.archivePhoto("photo-archived");
    await album.markProcessingStarted("photo-processing");
    const response = await handleListTimelinePhotos({ user, album, query: {}, deps: { photoObjects: withPresignDownload(async ({ objectKey }) => ({ url: `https://temporary.example/${objectKey}`, expiresInSeconds: 300 })) } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ photos: [
      { photoId: "photo-new", fileName: "new.jpg", capturedAt: "2025-01-02T10:00:00.000Z", processingState: "ready", archived: false, displayObjectKey: "display/user-1/photo-new.jpg", displayDimensions: { width: 1600, height: 1200 }, timelineThumbnailUrl: "https://temporary.example/timeline-thumbnails/user-1/photo-new.jpg", timelineThumbnailDimensions: { width: 320, height: 240 } },
      { photoId: "photo-old", fileName: "old.jpg", capturedAt: "2024-12-31T23:00:00.000Z", processingState: "ready", archived: false, displayObjectKey: "display/user-1/photo-old.jpg", displayDimensions: { width: 1600, height: 1200 }, timelineThumbnailUrl: "https://temporary.example/timeline-thumbnails/user-1/photo-old.jpg", timelineThumbnailDimensions: { width: 320, height: 240 } },
    ] });
  });

  it("applies year, month, processing state, and archived filters", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf(user.userId);
    await createPhoto(album, "photo-1", "photo-1.jpg");
    await createPhoto(album, "photo-2", "photo-2.jpg");
    await markReady(album, "photo-1", "photo-1.jpg", "2025-02-10T10:00:00.000Z");
    await markReady(album, "photo-2", "photo-2.jpg", "2025-02-11T10:00:00.000Z");
    await album.markProcessingFailed({ photoId: "photo-1", failureCode: "failed", failureMessage: "failed" });
    await album.archivePhoto("photo-1");
    const response = await handleListTimelinePhotos({ user, album, query: { year: "2025", month: "02", processingState: "processingFailed", archived: "true" }, deps: { photoObjects: withPresignDownload(async () => { throw new Error("should not sign thumbnails for non-ready photos"); }) } });
    expect(JSON.parse(response.body ?? "{}")).toEqual({ photos: [{ photoId: "photo-1", fileName: "photo-1.jpg", capturedAt: "2025-02-10T10:00:00.000Z", processingState: "processingFailed", archived: true, displayObjectKey: "display/user-1/photo-1.jpg", displayDimensions: { width: 1600, height: 1200 }, timelineThumbnailDimensions: { width: 320, height: 240 } }] });
  });
});
