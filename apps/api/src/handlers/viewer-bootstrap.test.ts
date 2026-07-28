import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handleViewerBootstrap } from "./viewer-bootstrap.js";

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
    uploadLocalDateTime: "2026-01-01T00:00:00",
    uploadContextTimeZone: "UTC",
  });
  await album.publishReadyPhoto({
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

describe("handleViewerBootstrap", () => {
  it("returns Viewer fields, chronology, display access, and live neighbours", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await readyPhoto(album, "jan", day("2024-01-01"));
    await readyPhoto(album, "jun", day("2024-06-15"));
    await readyPhoto(album, "dec", day("2024-12-31"));
    await album.setFavourite({ photoId: "jun", favourite: true });

    const response = await handleViewerBootstrap({
      user,
      album,
      photoId: "jun",
      requestedCollection: "active",
      deps: deps(),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.photoId).toBe("jun");
    expect(body.collection).toBe("active");
    expect(body.trashed).toBe(false);
    expect(body.favourite).toBe(true);
    expect(body.newerPhotoId).toBe("dec");
    expect(body.olderPhotoId).toBe("jan");
    expect(body.chronology.active.revision).toBe(0);
    expect(body.displayAccess.url).toContain("jun.jpg");
    expect(typeof body.displayAccess.expiresAt).toBe("string");
    expect(response.headers?.["cache-control"]).toBe("private, no-store");
  });

  it("infers the current collection when no source collection is requested", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await readyPhoto(album, "solo", day("2024-06-15"));

    const response = await handleViewerBootstrap({
      user,
      album,
      photoId: "solo",
      requestedCollection: undefined,
      deps: deps(),
    });
    const body = JSON.parse(response.body ?? "{}");
    expect(body.collection).toBe("active");
    expect(body.newerPhotoId).toBeUndefined();
    expect(body.olderPhotoId).toBeUndefined();
  });

  it("returns a structured conflict when the requested collection no longer contains the Photo", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await readyPhoto(album, "moved", day("2024-06-15"));
    await album.setTrashMembership({ photoId: "moved", trashed: true });

    const response = await handleViewerBootstrap({
      user,
      album,
      photoId: "moved",
      requestedCollection: "active",
      deps: deps(),
    });
    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.code).toBe("photo_collection_changed");
    expect(body.currentCollection).toBe("trashed");
  });

  it("rejects an invalid collection query value", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleViewerBootstrap({
      user,
      album,
      photoId: "any",
      requestedCollection: "invalid",
      deps: deps(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("404s for a missing Photo", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const response = await handleViewerBootstrap({
      user,
      album,
      photoId: "missing",
      requestedCollection: undefined,
      deps: deps(),
    });
    expect(response.statusCode).toBe(404);
  });

  it("409s for a Photo that is not yet Ready", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "pending",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/pending",
      fileName: "pending.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
      uploadLocalDateTime: "2026-01-01T00:00:00",
      uploadContextTimeZone: "UTC",
    });

    const response = await handleViewerBootstrap({
      user,
      album,
      photoId: "pending",
      requestedCollection: undefined,
      deps: deps(),
    });
    expect(response.statusCode).toBe(409);
  });
});
