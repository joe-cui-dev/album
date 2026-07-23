import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleRetryProcessing } from "./retry-processing.js";

const user = { userId: "user-1", email: "user@example.com" };
const seedPhoto = async (state: "processingFailed" | "ready") => {
  const store = createInMemoryPersonalAlbumStore();
  const album = store.personalAlbumOf(user.userId);
  await album.createPhoto({ photoId: "photo-1", uploadBatchId: "batch-1", originalObjectKey: "originals/user-1/batch-1/photo-1", fileName: state === "ready" ? "ready.jpg" : "broken.heic", format: "heic", contentType: "image/heic", fileSizeBytes: 42, uploadRequestedAt: "2026-05-26T01:02:03.000Z" });
  if (state === "processingFailed") {
    await album.markProcessingFailed({ photoId: "photo-1", failureCode: "unsupportedImage", failureMessage: "We couldn't process this photo." });
    await album.recordProcessingIssueV2({
      photoId: "photo-1",
      fileName: "broken.heic",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-05-26T01:02:03.000Z",
    });
  }
  else await album.markReady({ photoId: "photo-1", sha256: "hash", fileName: "ready.jpg", displayObjectKey: "display/user-1/photo-1.jpg", displayDimensions: { width: 1, height: 1 }, timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg", timelineThumbnailDimensions: { width: 1, height: 1 }, capturedAt: "2026-05-26T01:02:03.000Z", capturedAtSource: "exif", metadata: {} });
  return store;
};

describe("handleRetryProcessing", () => {
  it("sends a retry message for a failed Photo owned by the signed-in user", async () => {
    const messages: unknown[] = [];
    const response = await handleRetryProcessing({ user, album: (await seedPhoto("processingFailed")).personalAlbumOf(user.userId), photoId: "photo-1", deps: { sendRetryMessage: async (message) => { messages.push(message); }, newRetryAttemptId: () => "retry-1", now: () => new Date("2026-05-26T01:02:03.000Z") } });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ accepted: true, retryAttemptId: "retry-1" });
    expect(messages).toEqual([{ userId: "user-1", photoId: "photo-1", originalObjectKey: "originals/user-1/batch-1/photo-1", retryAttemptId: "retry-1" }]);
  });

  it("rejects retry requests for photos that are not processingFailed", async () => {
    const response = await handleRetryProcessing({ user, album: (await seedPhoto("ready")).personalAlbumOf(user.userId), photoId: "photo-1", deps: { sendRetryMessage: async () => { throw new Error("should not send retry messages for ready photos"); }, newRetryAttemptId: () => "retry-1", now: () => new Date() } });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ message: "Only failed photos can be retried" });
  });

  it("returns the existing in-flight attempt without sending a second message", async () => {
    const store = await seedPhoto("processingFailed");
    const album = store.personalAlbumOf(user.userId);
    await album.beginProcessingIssueRetryV2({
      photoId: "photo-1",
      retryAttemptId: "in-flight",
      attemptedAt: "2026-05-26T01:02:04.000Z",
    });
    const sendRetryMessage = jest.fn(async () => undefined);
    const response = await handleRetryProcessing({
      user, album, photoId: "photo-1",
      deps: { sendRetryMessage, newRetryAttemptId: () => "new-attempt", now: () => new Date() },
    });
    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ accepted: true, retryAttemptId: "in-flight" });
    expect(sendRetryMessage).not.toHaveBeenCalled();
  });

  it("releases the pending reservation when SQS rejects the message", async () => {
    const store = await seedPhoto("processingFailed");
    const album = store.personalAlbumOf(user.userId);
    await expect(handleRetryProcessing({
      user, album, photoId: "photo-1",
      deps: { sendRetryMessage: async () => { throw new Error("SQS unavailable"); }, newRetryAttemptId: () => "retry-1", now: () => new Date() },
    })).rejects.toThrow("SQS unavailable");
    await expect(album.getProcessingIssue("photo-1")).resolves.toMatchObject({ status: "failed" });
    expect((await album.getProcessingIssue("photo-1"))?.retryAttemptId).toBeUndefined();
  });
});
