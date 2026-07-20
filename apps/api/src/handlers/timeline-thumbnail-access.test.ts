import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handleTimelineThumbnailAccess } from "./timeline-thumbnail-access.js";

const user = { userId: "user-1", email: "user@example.com" };
const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "small.jpg", dimensions: { width: 320, height: 213 } },
  large: { objectKey: "large.jpg", dimensions: { width: 640, height: 427 } },
};
const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });
const deps = () => ({ photoObjects: createInMemoryPhotoObjectStore() });

const readyPhoto = async (
  album: ReturnType<ReturnType<typeof createInMemoryPersonalAlbumStore>["personalAlbumOf"]>,
  photoId: string,
) => {
  await album.createPhoto({
    photoId,
    uploadBatchId: "batch-1",
    originalObjectKey: `originals/user-1/batch-1/${photoId}`,
    fileName: `${photoId}.jpg`,
    format: "jpeg",
    contentType: "image/jpeg",
    fileSizeBytes: 42,
    uploadRequestedAt: "2026-01-01T00:00:00.000Z",
  });
  await album.publishReadyPhotoV2({
    photoId,
    fileName: `${photoId}.jpg`,
    sha256: `${photoId}-hash`,
    displayObjectKey: `display/user-1/${photoId}.jpg`,
    displayDimensions: dimensions,
    timelineThumbnails: thumbnails,
    metadata: {},
    originalCapturedAt: day("2024-06-15"),
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
};

describe("handleTimelineThumbnailAccess", () => {
  it("returns fresh Small/Large sources for Ready Photos and never leaks object keys", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await readyPhoto(album, "photo-1");

    const response = await handleTimelineThumbnailAccess({
      user,
      album,
      body: JSON.stringify({ photoIds: ["photo-1"] }),
      deps: deps(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photos).toEqual([
      {
        photoId: "photo-1",
        timelineThumbnailSources: {
          small: { url: expect.stringContaining("small.jpg"), dimensions: { width: 320, height: 213 } },
          large: { url: expect.stringContaining("large.jpg"), dimensions: { width: 640, height: 427 } },
        },
      },
    ]);
    expect(JSON.stringify(body).includes("objectKey")).toBe(false);
  });

  it("silently omits ids that are missing, not Ready, or belong to another user", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await readyPhoto(album, "ready-photo");
    await album.createPhoto({
      photoId: "not-ready",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/not-ready",
      fileName: "not-ready.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await handleTimelineThumbnailAccess({
      user,
      album,
      body: JSON.stringify({ photoIds: ["ready-photo", "not-ready", "missing"] }),
      deps: deps(),
    });
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photos.map((p: { photoId: string }) => p.photoId)).toEqual(["ready-photo"]);
  });

  it("rejects more than 100 photoIds", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleTimelineThumbnailAccess({
      user,
      album,
      body: JSON.stringify({ photoIds: Array.from({ length: 101 }, (_, i) => `photo-${i}`) }),
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an empty photoIds array", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleTimelineThumbnailAccess({
      user,
      album,
      body: JSON.stringify({ photoIds: [] }),
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a missing body", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleTimelineThumbnailAccess({ user, album, body: undefined, deps: deps() });
    expect(response.statusCode).toBe(400);
  });
});
