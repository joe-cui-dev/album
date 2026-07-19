import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleRetryProcessing } from "./retry-processing.js";

const user = { userId: "user-1", email: "user@example.com" };
const seedPhoto = async (state: "processingFailed" | "ready") => {
  const store = createInMemoryPersonalAlbumStore();
  const album = store.personalAlbumOf(user.userId);
  await album.createPhoto({ photoId: "photo-1", uploadBatchId: "batch-1", originalObjectKey: "originals/user-1/batch-1/photo-1", fileName: state === "ready" ? "ready.jpg" : "broken.heic", format: "heic", contentType: "image/heic", fileSizeBytes: 42, uploadRequestedAt: "2026-05-26T01:02:03.000Z" });
  if (state === "processingFailed") await album.markProcessingFailed({ photoId: "photo-1", failureCode: "unsupportedImage", failureMessage: "We couldn't process this photo." });
  else await album.markReady({ photoId: "photo-1", sha256: "hash", fileName: "ready.jpg", displayObjectKey: "display/user-1/photo-1.jpg", displayDimensions: { width: 1, height: 1 }, timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg", timelineThumbnailDimensions: { width: 1, height: 1 }, capturedAt: "2026-05-26T01:02:03.000Z", capturedAtSource: "exif", metadata: {} });
  return store;
};

describe("handleRetryProcessing", () => {
  it("sends a retry message for a failed Photo owned by the signed-in user", async () => {
    const messages: unknown[] = [];
    const response = await handleRetryProcessing({ user, album: (await seedPhoto("processingFailed")).personalAlbumOf(user.userId), photoId: "photo-1", deps: { sendRetryMessage: async (message) => { messages.push(message); } } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ photoId: "photo-1", fileName: "broken.heic", processingState: "processingFailed", exactDuplicate: false, failureCode: "unsupportedImage", failureMessage: "We couldn't process this photo." });
    expect(messages).toEqual([{ userId: "user-1", photoId: "photo-1", originalObjectKey: "originals/user-1/batch-1/photo-1" }]);
  });

  it("rejects retry requests for photos that are not processingFailed", async () => {
    const response = await handleRetryProcessing({ user, album: (await seedPhoto("ready")).personalAlbumOf(user.userId), photoId: "photo-1", deps: { sendRetryMessage: async () => { throw new Error("should not send retry messages for ready photos"); } } });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ message: "Only failed photos can be retried" });
  });
});
