import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleSetFavourite } from "./favourite-membership.js";

const user = { userId: "user-1", email: "user@example.com" };
const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "small.jpg", dimensions: { width: 320, height: 213 } },
  large: { objectKey: "large.jpg", dimensions: { width: 640, height: 427 } },
};
const june15: CapturedAt = { precision: "day", localDate: "2024-06-15" };

const readyAlbum = async () => {
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
    originalCapturedAt: june15,
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
  return album;
};

describe("handleSetFavourite", () => {
  it("marks a Ready Photo as Favourite without moving its projection", async () => {
    const album = await readyAlbum();
    const response = await handleSetFavourite({ user, album, photoId: "photo-1", favourite: true });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ photoId: "photo-1", favourite: true });
    await expect(album.getTimelineProjections("active")).resolves.toEqual([
      expect.objectContaining({ photoId: "photo-1", favourite: true }),
    ]);
  });

  it("unmarks a Favourite Photo", async () => {
    const album = await readyAlbum();
    await album.setFavourite({ photoId: "photo-1", favourite: true });

    const response = await handleSetFavourite({ user, album, photoId: "photo-1", favourite: false });
    expect(response.statusCode).toBe(200);
    await expect(album.getTimelineProjections("active")).resolves.toEqual([
      expect.objectContaining({ photoId: "photo-1", favourite: false }),
    ]);
  });

  it("is idempotent when already at the target Favourite state", async () => {
    const album = await readyAlbum();
    const response = await handleSetFavourite({ user, album, photoId: "photo-1", favourite: false });
    expect(response.statusCode).toBe(200);
  });

  it("returns 409 for a Photo that is not Ready", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "not-ready",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/not-ready",
      fileName: "not-ready.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
      uploadLocalDateTime: "2026-01-01T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    const response = await handleSetFavourite({ user, album, photoId: "not-ready", favourite: true });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for a missing Photo", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleSetFavourite({ user, album, photoId: "missing", favourite: true });
    expect(response.statusCode).toBe(404);
  });
});
