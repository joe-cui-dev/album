import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import { handleCreateOriginalDownloadUrl } from "./photo-actions.js";

const user = { userId: "user-1", email: "user@example.com" };
const withPresignDownload = (
  presignDownload: PhotoObjectStore["presignDownload"],
): PhotoObjectStore => ({ ...createInMemoryPhotoObjectStore(), presignDownload });

const createReadyAlbum = async () => {
  const store = createInMemoryPersonalAlbumStore();
  const album = store.personalAlbumOf(user.userId);
  await album.createPhoto({
    photoId: "photo-1", uploadBatchId: "batch-1", originalObjectKey: "originals/user-1/batch-1/photo-1",
    fileName: "beach.jpg", format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 1234,
    uploadRequestedAt: "2025-01-02T10:00:00.000Z",
    uploadLocalDateTime: "2025-01-02T10:00:00",
    uploadContextTimeZone: "UTC",
  });
  await album.publishReadyPhoto({
    photoId: "photo-1", sha256: "hash", fileName: "beach.jpg", displayObjectKey: "display/user-1/photo-1.jpg",
    displayDimensions: { width: 2048, height: 1536 },
    timelineThumbnails: {
      small: { objectKey: "timeline-thumbnails/user-1/photo-1.jpg", dimensions: { width: 320, height: 240 } },
      large: { objectKey: "timeline-thumbnails/user-1/photo-1-large.jpg", dimensions: { width: 640, height: 480 } },
    },
    metadata: { width: 4000, height: 3000, cameraMake: "Canon" },
    originalCapturedAt: { precision: "day", localDate: "2025-01-02" },
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
  return { store, album };
};

describe("photo action handlers", () => {
  it("creates a temporary original download URL for the signed-in user's original photo", async () => {
    const { album } = await createReadyAlbum();
    const response = await handleCreateOriginalDownloadUrl({
      user, album, photoId: "photo-1", deps: { photoObjects: withPresignDownload(async ({ objectKey, attachmentFileName }) => {
        expect(objectKey).toBe("originals/user-1/batch-1/photo-1"); expect(attachmentFileName).toBe("beach.jpg"); return { url: "https://temporary.example/original", expiresInSeconds: 300 };
      }) },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ url: "https://temporary.example/original", expiresInSeconds: 300 });
  });
});
