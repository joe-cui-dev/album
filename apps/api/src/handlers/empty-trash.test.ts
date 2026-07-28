import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handleEmptyTrash } from "./empty-trash.js";

const user = { userId: "user-1", email: "user@example.com" };
const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });

const createTrashedPhoto = async (album: ReturnType<ReturnType<typeof createInMemoryPersonalAlbumStore>["personalAlbumOf"]>, photoId: string) => {
  await album.createPhoto({
    photoId,
    uploadBatchId: "batch-1",
    originalObjectKey: `originals/${photoId}.jpg`,
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
    displayObjectKey: `display/${photoId}.jpg`,
    displayDimensions: { width: 100, height: 50 },
    timelineThumbnails: {
      small: { objectKey: `thumbnails/${photoId}-small.jpg`, dimensions: { width: 320, height: 160 } },
      large: { objectKey: `thumbnails/${photoId}-large.jpg`, dimensions: { width: 640, height: 320 } },
    },
    metadata: {},
    originalCapturedAt: day("2024-06-15"),
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
  await album.setTrashMembership({ photoId, trashed: true });
};

describe("handleEmptyTrash", () => {
  it("permanently deletes every Deleted Photo and remains idempotent when Trash is empty", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf(user.userId);
    await createTrashedPhoto(album, "one");
    await createTrashedPhoto(album, "two");
    const deps = { photoObjects: createInMemoryPhotoObjectStore() };

    await expect(handleEmptyTrash({ user, album, deps })).resolves.toMatchObject({ statusCode: 204 });
    await expect(album.getTimelineProjections("trashed")).resolves.toEqual([]);
    await expect(album.getPhoto("one")).resolves.toBeUndefined();
    await expect(album.getPhoto("two")).resolves.toBeUndefined();
    await expect(handleEmptyTrash({ user, album, deps })).resolves.toMatchObject({ statusCode: 204 });
  });
});
