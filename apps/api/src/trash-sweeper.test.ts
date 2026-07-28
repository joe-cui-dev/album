import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "./store/in-memory-store.js";
import { createInMemoryPhotoObjectStore } from "./store/in-memory-photo-object-store.js";
import { sweepExpiredTrash } from "./trash-sweeper.js";

const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });

const createDeletedPhoto = async ({
  store,
  photoObjects,
  userId,
  photoId,
}: {
  store: ReturnType<typeof createInMemoryPersonalAlbumStore>;
  photoObjects: ReturnType<typeof createInMemoryPhotoObjectStore>;
  userId: string;
  photoId: string;
}) => {
  const album = store.personalAlbumOf(userId);
  const keys = [
    `originals/${userId}/${photoId}.jpg`,
    `display/${userId}/${photoId}.jpg`,
    `thumbnails/${userId}/${photoId}-small.jpg`,
    `thumbnails/${userId}/${photoId}-large.jpg`,
  ];
  await album.createPhoto({
    photoId,
    uploadBatchId: "batch-1",
    originalObjectKey: keys[0]!,
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
    displayObjectKey: keys[1]!,
    displayDimensions: { width: 100, height: 50 },
    timelineThumbnails: {
      small: { objectKey: keys[2]!, dimensions: { width: 320, height: 160 } },
      large: { objectKey: keys[3]!, dimensions: { width: 640, height: 320 } },
    },
    metadata: {},
    originalCapturedAt: day("2024-06-15"),
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
  await album.setTrashMembership({ photoId, trashed: true });
  await Promise.all(keys.map((objectKey) => photoObjects.writeJpegObject({ objectKey, body: Uint8Array.from([1]) })));
  return { album, keys };
};

describe("sweepExpiredTrash", () => {
  afterEach(() => jest.useRealTimers());

  it("permanently deletes only Deleted Photos whose 30-day Retention Window has ended across Users", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = createInMemoryPersonalAlbumStore();
    const photoObjects = createInMemoryPhotoObjectStore();
    const expired = await createDeletedPhoto({ store, photoObjects, userId: "user-1", photoId: "expired" });

    jest.setSystemTime(new Date("2026-01-15T00:00:00.000Z"));
    const recent = await createDeletedPhoto({ store, photoObjects, userId: "user-2", photoId: "recent" });
    const order: string[] = [];
    const deleteObjects = photoObjects.deleteObjects.bind(photoObjects);
    const deleteRecord = expired.album.permanentlyDeletePhoto.bind(expired.album);
    photoObjects.deleteObjects = async (keys) => { order.push(`objects:${keys.join(",")}`); await deleteObjects(keys); };
    expired.album.permanentlyDeletePhoto = async (input) => { order.push("metadata"); await deleteRecord(input); };
    const sweepStore = {
      ...store,
      personalAlbumOf: (userId: string) => userId === "user-1" ? expired.album : store.personalAlbumOf(userId),
    };

    const result = await sweepExpiredTrash({
      store: sweepStore,
      photoObjects,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(result).toEqual({ deletedCount: 1 });
    await expect(expired.album.getPhoto("expired")).resolves.toBeUndefined();
    await expect(recent.album.getPhoto("recent")).resolves.toBeDefined();
    await expect(Promise.all(expired.keys.map((key) => photoObjects.objectExists(key)))).resolves.toEqual([false, false, false, false]);
    await expect(Promise.all(recent.keys.map((key) => photoObjects.objectExists(key)))).resolves.toEqual([true, true, true, true]);
    expect(order).toEqual([`objects:${expired.keys.join(",")}`, "metadata"]);
  });

  it("can run again after a prior sweep", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = createInMemoryPersonalAlbumStore();
    const photoObjects = createInMemoryPhotoObjectStore();
    await createDeletedPhoto({ store, photoObjects, userId: "user-1", photoId: "expired" });
    const input = { store, photoObjects, now: new Date("2026-02-01T00:00:00.000Z") };

    await sweepExpiredTrash(input);

    await expect(sweepExpiredTrash(input)).resolves.toEqual({ deletedCount: 0 });
  });

  it("retries an S3 failure on a later sweep without making the Deleted Photo restorable", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = createInMemoryPersonalAlbumStore();
    const photoObjects = createInMemoryPhotoObjectStore();
    const expired = await createDeletedPhoto({ store, photoObjects, userId: "user-1", photoId: "expired" });
    const deleteObjects = photoObjects.deleteObjects.bind(photoObjects);
    let firstAttempt = true;
    photoObjects.deleteObjects = async (keys) => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("S3 temporary failure");
      }
      await deleteObjects(keys);
    };
    const input = { store, photoObjects, now: new Date("2026-02-01T00:00:00.000Z") };

    await expect(sweepExpiredTrash(input)).rejects.toThrow("S3 temporary failure");
    await expect(expired.album.setTrashMembership({ photoId: "expired", trashed: false })).rejects.toThrow("changed concurrently");
    await expect(sweepExpiredTrash(input)).resolves.toEqual({ deletedCount: 1 });
    await expect(expired.album.getPhoto("expired")).resolves.toBeUndefined();
  });
});
