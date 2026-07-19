import sharp from "sharp";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { createDisplayPhoto, createTimelineThumbnail, handleProcessPhoto } from "./process-photo.js";

const objectKey = "originals/user-1/batch-1/photo-1";
const record = (body: Record<string, unknown> = { Records: [{ s3: { object: { key: objectKey } } }] }) => [{ messageId: "message-1", body: JSON.stringify(body) }];
const createStore = async (state: "uploadRequested" | "processingFailed" = "uploadRequested") => {
  const store = createInMemoryPersonalAlbumStore();
  const album = store.personalAlbumOf("user-1");
  await album.createPhoto({ photoId: "photo-1", uploadBatchId: "batch-1", originalObjectKey: objectKey, fileName: "beach.jpg", format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 42, uploadRequestedAt: "2026-05-26T01:02:03.000Z", fileModifiedAt: "2026-01-02T03:04:05.000Z" });
  if (state === "processingFailed") await album.markProcessingFailed({ photoId: "photo-1", failureCode: "failed", failureMessage: "failed" });
  return { store, album };
};
const validMetadata = async () => ({ "user-id": "user-1", "upload-batch-id": "batch-1", "photo-id": "photo-1" });
const outputDeps = () => ({
  readObjectBytes: async () => Buffer.from("jpeg bytes"),
  createDisplayPhoto: async () => ({ body: Buffer.from("display jpeg"), dimensions: { width: 2048, height: 1365 }, metadata: { width: 3000, height: 2000, cameraMake: "Fuji" } }),
  createTimelineThumbnail: async () => ({ body: Buffer.from("timeline thumbnail jpeg"), dimensions: { width: 320, height: 213 } }),
  writeDisplayPhoto: async () => undefined,
  writeTimelineThumbnail: async () => undefined,
});

describe("handleProcessPhoto", () => {
  it("marks the matching Photo as processingFailed when S3 metadata does not match the original object key", async () => {
    const { store, album } = await createStore();
    await handleProcessPhoto({ records: record(), deps: { store, getObjectMetadata: async () => ({ "user-id": "user-1", "upload-batch-id": "batch-1", "photo-id": "different-photo" }), ...outputDeps() } });
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({ processingState: "processingFailed", failureCode: "metadataMismatch", failureMessage: "We couldn't verify this upload. Please try again." });
  });

  it("uses the processor-computed S3 hash to mark exact duplicates within the same Personal Album", async () => {
    const { store, album } = await createStore();
    await album.createPhoto({ photoId: "already-ready", uploadBatchId: "batch-0", originalObjectKey: "originals/user-1/batch-0/already-ready", fileName: "old.jpg", format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 42, uploadRequestedAt: "2026-01-01T00:00:00.000Z" });
    await album.markReady({ photoId: "already-ready", sha256: "acb0eceee37f7978363e33aabc1d415a92e79f9d58bea527d4eae0a8ac1ed3d3", fileName: "old.jpg", displayObjectKey: "display/user-1/already-ready.jpg", displayDimensions: { width: 1, height: 1 }, timelineThumbnailObjectKey: "timeline-thumbnails/user-1/already-ready.jpg", timelineThumbnailDimensions: { width: 1, height: 1 }, capturedAt: "2026-01-01T00:00:00.000Z", capturedAtSource: "exif", metadata: {} });
    await handleProcessPhoto({ records: record(), deps: { store, getObjectMetadata: validMetadata, ...outputDeps(), readObjectBytes: async () => Buffer.from("uploaded original bytes") } });
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({ processingState: "exactDuplicate", sha256: "acb0eceee37f7978363e33aabc1d415a92e79f9d58bea527d4eae0a8ac1ed3d3", duplicateOfPhotoId: "already-ready" });
  });

  it("writes derived JPEGs and marks the Photo ready in the Timeline", async () => {
    const { store, album } = await createStore();
    const displayWrites: unknown[] = [];
    const thumbnailWrites: unknown[] = [];
    await handleProcessPhoto({ records: record(), deps: { store, getObjectMetadata: validMetadata, ...outputDeps(), writeDisplayPhoto: async (input) => { displayWrites.push(input); }, writeTimelineThumbnail: async (input) => { thumbnailWrites.push(input); } } });
    expect(displayWrites).toEqual([{ objectKey: "display/user-1/photo-1.jpg", body: Buffer.from("display jpeg") }]);
    expect(thumbnailWrites).toEqual([{ objectKey: "timeline-thumbnails/user-1/photo-1.jpg", body: Buffer.from("timeline thumbnail jpeg") }]);
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({ processingState: "ready", sha256: "1b48e21282963dfba2ffff3a4c331471242fe42fd0a51161e56df72085c445c9", displayObjectKey: "display/user-1/photo-1.jpg", timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg", capturedAt: "2026-01-02T03:04:05.000Z", capturedAtSource: "fileModifiedTime", metadata: { width: 3000, height: 2000, cameraMake: "Fuji" } });
    await expect(album.listTimelinePhotos({ processingState: "ready", archived: false })).resolves.toMatchObject([{ photoId: "photo-1" }]);
  });

  it("uses EXIF captured time from decoded photo metadata before file modified time", async () => {
    const { store, album } = await createStore();
    await handleProcessPhoto({ records: record(), deps: { store, getObjectMetadata: validMetadata, ...outputDeps(), createDisplayPhoto: async () => ({ body: Buffer.from("display jpeg"), dimensions: { width: 1200, height: 800 }, metadata: { width: 1200, height: 800 }, capturedAt: "2025-12-24T10:11:12.000Z" }) } });
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({ capturedAt: "2025-12-24T10:11:12.000Z", capturedAtSource: "exif" });
  });

  it("processes custom retry messages from the Retry Processing API", async () => {
    const { store, album } = await createStore("processingFailed");
    await handleProcessPhoto({ records: record({ type: "retryPhotoProcessing", userId: "user-1", photoId: "photo-1", originalObjectKey: objectKey }), deps: { store, getObjectMetadata: validMetadata, ...outputDeps() } });
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({ processingState: "ready" });
  });
});

describe("createDisplayPhoto", () => {
  it("extracts captured time, camera, lens, location, and oriented display dimensions from EXIF", async () => {
    const original = await sharp({ create: { width: 16, height: 8, channels: 3, background: "#6699cc" } }).jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Make: "Fuji", Model: "X100V" }, IFD2: { DateTimeOriginal: "2025:12:24 10:11:12", LensModel: "23mm F2" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "27/1 28/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "153/1 1/1 0/1" } }).toBuffer();
    const result = await createDisplayPhoto(original);
    expect(result.capturedAt).toBe("2025-12-24T10:11:12.000Z");
    expect(result.metadata).toEqual({ width: 16, height: 8, cameraMake: "Fuji", cameraModel: "X100V", lensModel: "23mm F2", location: { latitude: -27.466666666666665, longitude: 153.01666666666668 } });
    expect(result.dimensions).toEqual({ width: 8, height: 16 });
    await expect(sharp(result.body).metadata()).resolves.toMatchObject({ format: "jpeg", width: 8, height: 16 });
  });

  it("writes display photos as JPEG with longest edge constrained to 2048 pixels without enlarging small images", async () => {
    const large = await sharp({ create: { width: 4096, height: 1024, channels: 3, background: "#cc9966" } }).png().toBuffer();
    const small = await sharp({ create: { width: 32, height: 16, channels: 3, background: "#99cc66" } }).jpeg().toBuffer();
    const [largeResult, smallResult] = await Promise.all([createDisplayPhoto(large), createDisplayPhoto(small)]);
    await expect(sharp(largeResult.body).metadata()).resolves.toMatchObject({ format: "jpeg", width: 2048, height: 512 });
    expect(largeResult.dimensions).toEqual({ width: 2048, height: 512 });
    await expect(sharp(smallResult.body).metadata()).resolves.toMatchObject({ format: "jpeg", width: 32, height: 16 });
    expect(smallResult.dimensions).toEqual({ width: 32, height: 16 });
  });
});

describe("createTimelineThumbnail", () => {
  it("writes timeline thumbnails as JPEG with longest edge constrained to 320 pixels without enlarging small images", async () => {
    const large = await sharp({ create: { width: 4096, height: 1024, channels: 3, background: "#6699cc" } }).png().toBuffer();
    const small = await sharp({ create: { width: 32, height: 16, channels: 3, background: "#99cc66" } }).jpeg().toBuffer();
    const [largeResult, smallResult] = await Promise.all([createTimelineThumbnail(large), createTimelineThumbnail(small)]);
    await expect(sharp(largeResult.body).metadata()).resolves.toMatchObject({ format: "jpeg", width: 320, height: 80 });
    expect(largeResult.dimensions).toEqual({ width: 320, height: 80 });
    await expect(sharp(smallResult.body).metadata()).resolves.toMatchObject({ format: "jpeg", width: 32, height: 16 });
    expect(smallResult.dimensions).toEqual({ width: 32, height: 16 });
  });
});
