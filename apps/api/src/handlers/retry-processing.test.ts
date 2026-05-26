import { handleRetryProcessing } from "./retry-processing.js";

describe("handleRetryProcessing", () => {
  it("sends a retry message for a failed Photo owned by the signed-in user", async () => {
    const messages: unknown[] = [];

    const response = await handleRetryProcessing({
      user: { userId: "user-1", email: "user@example.com" },
      photoId: "photo-1",
      deps: {
        getPhoto: async ({ userId, photoId }) => {
          expect(userId).toBe("user-1");
          expect(photoId).toBe("photo-1");
          return {
            photoId: "photo-1",
            fileName: "broken.heic",
            processingState: "processingFailed",
            originalObjectKey: "originals/user-1/batch-1/photo-1",
            failureCode: "unsupportedImage",
            failureMessage: "We couldn't process this photo.",
          };
        },
        sendRetryMessage: async (message) => {
          messages.push(message);
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      photoId: "photo-1",
      fileName: "broken.heic",
      processingState: "processingFailed",
      exactDuplicate: false,
      failureCode: "unsupportedImage",
      failureMessage: "We couldn't process this photo.",
    });
    expect(messages).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
        originalObjectKey: "originals/user-1/batch-1/photo-1",
      },
    ]);
  });

  it("rejects retry requests for photos that are not processingFailed", async () => {
    const response = await handleRetryProcessing({
      user: { userId: "user-1", email: "user@example.com" },
      photoId: "photo-1",
      deps: {
        getPhoto: async () => ({
          photoId: "photo-1",
          fileName: "ready.jpg",
          processingState: "ready",
          originalObjectKey: "originals/user-1/batch-1/photo-1",
        }),
        sendRetryMessage: async () => {
          throw new Error("should not send retry messages for ready photos");
        },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      message: "Only failed photos can be retried",
    });
  });
});
