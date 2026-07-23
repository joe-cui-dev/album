import sharp from "sharp";
import { createInMemoryPhotoObjectStore } from "./store/in-memory-photo-object-store.js";
import { createInMemoryPersonalAlbumStore } from "./store/in-memory-store.js";
import { maintainPhoto } from "./maintenance.js";

describe("maintainPhoto", () => {
  it("backfills a legacy Ready Photo from its Original without replacing its Display Photo", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const originalObjectKey = "originals/user-1/batch-1/photo-1";
    const displayObjectKey = "display/user-1/photo-1.jpg";
    const original = await sharp({
      create: { width: 800, height: 400, channels: 3, background: "#6699cc" },
    }).jpeg().withExif({ IFD2: { DateTimeOriginal: "2025:12:24 10:11:12" } }).toBuffer();
    const objects = createInMemoryPhotoObjectStore([
      { objectKey: originalObjectKey, body: original, contentType: "image/jpeg", metadata: { "user-id": "user-1", "upload-batch-id": "batch-1", "photo-id": "photo-1" } },
      { objectKey: displayObjectKey, body: Buffer.from("existing display"), contentType: "image/jpeg", metadata: {} },
    ]);
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey,
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: original.byteLength,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
    });
    await album.markReady({
      photoId: "photo-1",
      sha256: "hash",
      fileName: "photo-1.jpg",
      displayObjectKey,
      displayDimensions: { width: 800, height: 400 },
      timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg",
      timelineThumbnailDimensions: { width: 320, height: 160 },
      capturedAt: "2025-12-24T10:11:12.000Z",
      capturedAtSource: "exif",
      metadata: {},
    });

    await expect(maintainPhoto(
      { type: "backfillReadyPhoto", userId: "user-1", photoId: "photo-1", migrationVersion: 1 },
      { store, photoObjects: objects, now: () => new Date("2026-07-20T00:00:00.000Z") },
    )).resolves.toBe("completed");

    await expect(objects.readObjectBytes(displayObjectKey)).resolves.toEqual(Buffer.from("existing display"));
    await expect(objects.readObjectBytes("timeline-thumbnails/user-1/photo-1.jpg")).resolves.toBeDefined();
    await expect(objects.readObjectBytes("timeline-thumbnails/user-1/photo-1-large.jpg")).resolves.toBeDefined();
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({
      migrationVersion: 1,
      chronology: { active: { capturedAt: { precision: "dateTime", localDate: "2025-12-24" } } },
    });
  });
});
