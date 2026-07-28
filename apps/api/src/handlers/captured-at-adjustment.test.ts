import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleAdjustCapturedAt, handleRevertCapturedAt } from "./captured-at-adjustment.js";

const user = { userId: "user-1", email: "user@example.com" };
const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "small.jpg", dimensions: { width: 320, height: 213 } },
  large: { objectKey: "large.jpg", dimensions: { width: 640, height: 427 } },
};
const june15: CapturedAt = { precision: "day", localDate: "2024-06-15" };
const july04: CapturedAt = { precision: "day", localDate: "2024-07-04" };

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

describe("handleAdjustCapturedAt", () => {
  it("replaces the active chronology and returns the new revision as the ETag", async () => {
    const album = await readyAlbum();

    const response = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: july04 }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers?.etag).toBe('"1"');
    const body = JSON.parse(response.body ?? "{}");
    expect(body.chronology).toEqual({
      original: { capturedAt: june15, source: "exif" },
      active: { capturedAt: july04, source: "userAdjusted", revision: 1 },
    });
  });

  it("requires If-Match: missing returns 428, malformed returns 400", async () => {
    const album = await readyAlbum();
    const missing = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: undefined,
      body: JSON.stringify({ capturedAt: july04 }),
    });
    expect(missing.statusCode).toBe(428);

    const malformed = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: "not-a-number",
      body: JSON.stringify({ capturedAt: july04 }),
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("returns 412 for a stale revision", async () => {
    const album = await readyAlbum();
    await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: july04 }),
    });

    const response = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: june15 }),
    });
    expect(response.statusCode).toBe(412);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({ code: "chronology_changed" });
  });

  it("rejects an invalid capturedAt body", async () => {
    const album = await readyAlbum();
    const response = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: { precision: "day", localDate: "2024-02-30" } }),
    });
    expect(response.statusCode).toBe(400);
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
    const response = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "not-ready",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: july04 }),
    });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for a missing Photo", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "missing",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: july04 }),
    });
    expect(response.statusCode).toBe(404);
  });

  it("applies to an Trashed Photo", async () => {
    const album = await readyAlbum();
    await album.setTrashMembership({ photoId: "photo-1", trashed: true });

    const response = await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: july04 }),
    });
    expect(response.statusCode).toBe(200);
    await expect(album.getTimelineProjections("trashed")).resolves.toEqual([
      expect.objectContaining({ photoId: "photo-1", capturedAt: july04 }),
    ]);
  });
});

describe("handleRevertCapturedAt", () => {
  it("restores the original chronology without advancing the revision when already at original", async () => {
    const album = await readyAlbum();
    const response = await handleRevertCapturedAt({ user, album, photoId: "photo-1", ifMatch: '"0"' });
    expect(response.statusCode).toBe(200);
    expect(response.headers?.etag).toBe('"0"');
  });

  it("reverts an adjusted Photo and bumps the revision", async () => {
    const album = await readyAlbum();
    await handleAdjustCapturedAt({
      user,
      album,
      photoId: "photo-1",
      ifMatch: '"0"',
      body: JSON.stringify({ capturedAt: july04 }),
    });

    const response = await handleRevertCapturedAt({ user, album, photoId: "photo-1", ifMatch: '"1"' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.chronology.active).toEqual({ capturedAt: june15, source: "exif", revision: 2 });
  });

  it("requires If-Match", async () => {
    const album = await readyAlbum();
    const response = await handleRevertCapturedAt({ user, album, photoId: "photo-1", ifMatch: undefined });
    expect(response.statusCode).toBe(428);
  });
});
