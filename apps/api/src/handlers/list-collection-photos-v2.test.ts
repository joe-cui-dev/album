import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handleListCollectionPhotosV2 } from "./list-collection-photos-v2.js";

const user = { userId: "user-1", email: "user@example.com" };
const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "small.jpg", dimensions: { width: 320, height: 213 } },
  large: { objectKey: "large.jpg", dimensions: { width: 640, height: 427 } },
};
const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });

const createReadyPhoto = async (
  album: ReturnType<ReturnType<typeof createInMemoryPersonalAlbumStore>["personalAlbumOf"]>,
  photoId: string,
  capturedAt: CapturedAt,
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
    originalCapturedAt: capturedAt,
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
};

const deps = () => ({ photoObjects: createInMemoryPhotoObjectStore() });

describe("handleListCollectionPhotosV2", () => {
  it("returns Photos newest first with responsive thumbnail sources and an anchor period", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await createReadyPhoto(album, "jan", day("2024-01-01"));
    await createReadyPhoto(album, "jun", day("2024-06-15"));

    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: {},
      deps: deps(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photos.map((p: { photoId: string }) => p.photoId)).toEqual(["jun", "jan"]);
    expect(body.anchorPeriod).toEqual({ year: 2024, month: 6 });
    expect(body.photos[0].timelineThumbnailSources).toEqual({
      small: { url: expect.stringContaining("small.jpg"), dimensions: { width: 320, height: 213 } },
      large: { url: expect.stringContaining("large.jpg"), dimensions: { width: 640, height: 427 } },
    });
    expect(JSON.stringify(body).includes("objectKey")).toBe(false);
    expect(response.headers?.["cache-control"]).toBe("private, no-store");
    expect(typeof body.expiresAt).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("omits expiresAt when the page is empty", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");

    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: {},
      deps: deps(),
    });
    const body = JSON.parse(response.body ?? "{}");
    expect(body.expiresAt).toBeUndefined();
  });

  it("collapses to Large when actual thumbnail widths match", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "tiny",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/tiny",
      fileName: "tiny.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
    });
    await album.publishReadyPhotoV2({
      photoId: "tiny",
      fileName: "tiny.jpg",
      sha256: "hash",
      displayObjectKey: "display/user-1/tiny.jpg",
      displayDimensions: dimensions,
      timelineThumbnails: {
        small: { objectKey: "small.jpg", dimensions: { width: 100, height: 66 } },
        large: { objectKey: "large.jpg", dimensions: { width: 100, height: 66 } },
      },
      metadata: {},
      originalCapturedAt: day("2024-01-01"),
      originalCapturedAtSource: "exif",
      hadOpenProcessingIssue: false,
    });

    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: {},
      deps: deps(),
    });
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photos[0].timelineThumbnailSources).toEqual({
      large: { url: expect.stringContaining("large.jpg"), dimensions: { width: 100, height: 66 } },
    });
  });

  it("paginates with limit and returns an opaque nextCursor that continues strictly after the page", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await createReadyPhoto(album, "jan", day("2024-01-01"));
    await createReadyPhoto(album, "feb", day("2024-02-01"));
    await createReadyPhoto(album, "mar", day("2024-03-01"));

    const firstPage = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { limit: "2" },
      deps: deps(),
    });
    const firstBody = JSON.parse(firstPage.body ?? "{}");
    expect(firstBody.photos.map((p: { photoId: string }) => p.photoId)).toEqual(["mar", "feb"]);
    expect(typeof firstBody.nextCursor).toBe("string");

    const secondPage = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { cursor: firstBody.nextCursor },
      deps: deps(),
    });
    const secondBody = JSON.parse(secondPage.body ?? "{}");
    expect(secondBody.photos.map((p: { photoId: string }) => p.photoId)).toEqual(["jan"]);
    expect(secondBody.nextCursor).toBeUndefined();
  });

  it("rejects a cursor from the other collection", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await createReadyPhoto(album, "jan", day("2024-01-01"));
    await createReadyPhoto(album, "feb", day("2024-02-01"));
    const firstPage = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { limit: "1" },
      deps: deps(),
    });
    const { nextCursor } = JSON.parse(firstPage.body ?? "{}");

    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "archived",
      query: { cursor: nextCursor },
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects cursor and startAt together", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { cursor: "x", startAt: "2024-06" },
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it.each(["0", "101", "abc", "1.5"])("rejects an invalid limit %s", async (limit) => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { limit },
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("anchors a continuous older stream at startAt", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await createReadyPhoto(album, "aug", day("2024-08-01"));
    await createReadyPhoto(album, "jun", day("2024-06-15"));
    await createReadyPhoto(album, "jan", day("2024-01-01"));

    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { startAt: "2024-06" },
      deps: deps(),
    });
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photos.map((p: { photoId: string }) => p.photoId)).toEqual(["jun", "jan"]);
  });

  it("returns a conflict when the startAt period is empty", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await createReadyPhoto(album, "jan", day("2024-01-01"));

    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { startAt: "2024-06" },
      deps: deps(),
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}").code).toBe("empty_period");
  });

  it("rejects an invalid startAt", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: { startAt: "not-a-period" },
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("keeps Active and Archived independent", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await createReadyPhoto(album, "active-1", day("2024-01-01"));
    await createReadyPhoto(album, "archived-1", day("2024-02-01"));
    await album.setArchiveMembershipV2({ photoId: "archived-1", archived: true });

    const timeline = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "active",
      query: {},
      deps: deps(),
    });
    const archive = await handleListCollectionPhotosV2({
      user,
      album,
      collection: "archived",
      query: {},
      deps: deps(),
    });
    expect(JSON.parse(timeline.body ?? "{}").photos.map((p: { photoId: string }) => p.photoId)).toEqual([
      "active-1",
    ]);
    expect(JSON.parse(archive.body ?? "{}").photos.map((p: { photoId: string }) => p.photoId)).toEqual([
      "archived-1",
    ]);
  });
});
