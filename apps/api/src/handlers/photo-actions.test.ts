import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";
import { createInMemoryPhotoObjectStore } from "../store/in-memory-photo-object-store.js";
import {
  handleCreateDisplayAccessUrl,
  handleCreateOriginalDownloadUrl,
  handleGetPhotoDetail,
} from "./photo-actions.js";

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
  });
  await album.markReady({
    photoId: "photo-1", sha256: "hash", fileName: "beach.jpg", displayObjectKey: "display/user-1/photo-1.jpg",
    displayDimensions: { width: 2048, height: 1536 }, timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg",
    timelineThumbnailDimensions: { width: 320, height: 240 }, capturedAt: "2025-01-02T10:00:00.000Z", capturedAtSource: "exif",
    metadata: { width: 4000, height: 3000, cameraMake: "Canon" },
  });
  return { store, album };
};

describe("photo action handlers", () => {
  it("returns read-only photo metadata for a signed-in user's photo", async () => {
    const { album } = await createReadyAlbum();
    const response = await handleGetPhotoDetail({ user, album, photoId: "photo-1" });
    const body = JSON.parse(response.body ?? "{}");
    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      photoId: "photo-1", fileName: "beach.jpg", format: "jpeg", fileSizeBytes: 1234,
      capturedAt: "2025-01-02T10:00:00.000Z", capturedAtSource: "exif", processingState: "ready", archived: false,
      metadata: { width: 4000, height: 3000, cameraMake: "Canon" }, displayDimensions: { width: 2048, height: 1536 },
    });
    expect(JSON.stringify(body).includes("originalObjectKey")).toBe(false);
    expect(JSON.stringify(body).includes("displayObjectKey")).toBe(false);
  });

  it("creates a temporary display access URL only for ready photos with display output", async () => {
    const { album } = await createReadyAlbum();
    const response = await handleCreateDisplayAccessUrl({
      user, album, photoId: "photo-1", deps: { photoObjects: withPresignDownload(async ({ objectKey }) => {
        expect(objectKey).toBe("display/user-1/photo-1.jpg"); return { url: "https://temporary.example/display", expiresInSeconds: 300 };
      }) },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ url: "https://temporary.example/display", expiresInSeconds: 300 });
  });

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
