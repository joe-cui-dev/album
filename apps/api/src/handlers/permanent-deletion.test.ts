import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handlePermanentDeletion } from "./permanent-deletion.js";
import { permanentlyDeletePhoto } from "../permanent-deletion.js";

const user = { userId: "user-1", email: "user@example.com" };
const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });

const objectKeys = [
  "originals/user-1/batch-1/photo-1.jpg",
  "display/user-1/photo-1.jpg",
  "timeline-thumbnails/user-1/photo-1-small.jpg",
  "timeline-thumbnails/user-1/photo-1-large.jpg",
];

const createTrashedPhoto = async () => {
  const store = createInMemoryPersonalAlbumStore();
  const album = store.personalAlbumOf(user.userId);
  const photoObjects = createInMemoryPhotoObjectStore(
    objectKeys.map((objectKey) => ({
      objectKey,
      body: Uint8Array.from([1]),
      contentType: "image/jpeg",
      metadata: {},
    })),
  );
  await album.createPhoto({
    photoId: "photo-1",
    uploadBatchId: "batch-1",
    originalObjectKey: objectKeys[0]!,
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
    sha256: "photo-1-hash",
    displayObjectKey: objectKeys[1]!,
    displayDimensions: { width: 100, height: 50 },
    timelineThumbnails: {
      small: { objectKey: objectKeys[2]!, dimensions: { width: 320, height: 160 } },
      large: { objectKey: objectKeys[3]!, dimensions: { width: 640, height: 320 } },
    },
    metadata: {},
    originalCapturedAt: day("2024-06-15"),
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
  await album.setTrashMembership({ photoId: "photo-1", trashed: true });
  return { album, photoObjects };
};

describe("handlePermanentDeletion", () => {
  it("permanently deletes a Trashed Photo's objects before its Photo, projection, and Date Index", async () => {
    const { album, photoObjects } = await createTrashedPhoto();

    const response = await handlePermanentDeletion({
      user,
      album,
      photoId: "photo-1",
      deps: { photoObjects },
    });

    expect(response.statusCode).toBe(204);
    await expect(album.getPhoto("photo-1")).resolves.toBeUndefined();
    await expect(album.getTimelineProjections("trashed")).resolves.toEqual([]);
    await expect(album.getDateIndex("trashed", 2024)).resolves.toEqual({});
    await expect(Promise.all(objectKeys.map((key) => photoObjects.objectExists(key)))).resolves.toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("is safe to repeat after the Photo is already permanently deleted", async () => {
    const { album, photoObjects } = await createTrashedPhoto();
    const input = { user, album, photoId: "photo-1", deps: { photoObjects } };

    await handlePermanentDeletion(input);

    await expect(handlePermanentDeletion(input)).resolves.toMatchObject({ statusCode: 204 });
  });

  it("deletes the exact four object keys before committing the metadata transaction", async () => {
    const { album, photoObjects } = await createTrashedPhoto();
    const order: string[] = [];
    const deleteObjects = photoObjects.deleteObjects.bind(photoObjects);
    const deleteRecord = album.permanentlyDeletePhoto.bind(album);
    photoObjects.deleteObjects = async (keys) => { order.push(`objects:${keys.join(",")}`); await deleteObjects(keys); };
    album.permanentlyDeletePhoto = async (input) => { order.push("metadata"); await deleteRecord(input); };

    await handlePermanentDeletion({ user, album, photoId: "photo-1", deps: { photoObjects } });

    expect(order).toEqual([`objects:${objectKeys.join(",")}`, "metadata"]);
  });

  it("keeps a Photo reserved after an S3 failure so a later retry, not Restore, recovers it", async () => {
    const { album, photoObjects } = await createTrashedPhoto();
    const deleteObjects = photoObjects.deleteObjects.bind(photoObjects);
    photoObjects.deleteObjects = async () => { throw new Error("S3 partial failure"); };

    await expect(permanentlyDeletePhoto({ album, photoObjects, photoId: "photo-1" })).rejects.toThrow("S3 partial failure");
    await expect(album.getPhoto("photo-1")).resolves.toBeDefined();
    await expect(album.setTrashMembership({ photoId: "photo-1", trashed: false })).rejects.toThrow("changed concurrently");
    photoObjects.deleteObjects = deleteObjects;
    await permanentlyDeletePhoto({ album, photoObjects, photoId: "photo-1" });
    await expect(album.getPhoto("photo-1")).resolves.toBeUndefined();
  });

  it("blocks a concurrent Restore before deleting a Deleted Photo's objects", async () => {
    const { album, photoObjects } = await createTrashedPhoto();
    const deleteObjects = photoObjects.deleteObjects.bind(photoObjects);
    photoObjects.deleteObjects = async (keys) => {
      await expect(album.setTrashMembership({ photoId: "photo-1", trashed: false })).rejects.toThrow("changed concurrently");
      await deleteObjects(keys);
    };

    await permanentlyDeletePhoto({ album, photoObjects, photoId: "photo-1" });

    await expect(album.getPhoto("photo-1")).resolves.toBeUndefined();
  });
});
