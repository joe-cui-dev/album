import { handleProcessPhoto } from "./process-photo.js";

describe("handleProcessPhoto", () => {
  it("marks the matching Photo as processingFailed when S3 metadata does not match the original object key", async () => {
    const failures: unknown[] = [];

    await handleProcessPhoto({
      records: [
        {
          messageId: "message-1",
          body: JSON.stringify({
            Records: [
              {
                s3: {
                  object: {
                    key: "originals/user-1/batch-1/photo-1",
                  },
                },
              },
            ],
          }),
        },
      ],
      deps: {
        getObjectMetadata: async () => ({
          "user-id": "user-1",
          "upload-batch-id": "batch-1",
          "photo-id": "different-photo",
        }),
        getPhoto: async ({ userId, photoId }) => {
          if (userId === "user-1" && photoId === "photo-1") {
            return {
              photoId: "photo-1",
              userId: "user-1",
              uploadBatchId: "batch-1",
              originalObjectKey: "originals/user-1/batch-1/photo-1",
              processingState: "uploadRequested",
            };
          }
          return undefined;
        },
        markProcessingFailed: async (input) => {
          failures.push(input);
        },
        markProcessingStarted: async () => {
          throw new Error("should not process mismatched uploads");
        },
        readObjectBytes: async () => {
          throw new Error("should not read mismatched uploads");
        },
        findReadyPhotoBySha256: async () => {
          throw new Error("should not check duplicates for mismatched uploads");
        },
        markExactDuplicate: async () => {
          throw new Error("should not mark mismatched uploads as duplicates");
        },
        createDisplayPhoto: async () => {
          throw new Error("should not create display photos for mismatches");
        },
        writeDisplayPhoto: async () => {
          throw new Error("should not write display photos for mismatches");
        },
        markReady: async () => {
          throw new Error("should not mark mismatched uploads ready");
        },
        putTimelineItem: async () => {
          throw new Error("should not write timeline items for mismatches");
        },
      },
    });

    expect(failures).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
        failureCode: "metadataMismatch",
        failureMessage: "We couldn't verify this upload. Please try again.",
      },
    ]);
  });

  it("uses the processor-computed S3 hash to mark exact duplicates within the same Personal Album", async () => {
    const started: unknown[] = [];
    const duplicates: unknown[] = [];

    await handleProcessPhoto({
      records: [
        {
          messageId: "message-1",
          body: JSON.stringify({
            Records: [
              {
                s3: {
                  object: {
                    key: "originals/user-1/batch-1/photo-1",
                  },
                },
              },
            ],
          }),
        },
      ],
      deps: {
        getObjectMetadata: async () => ({
          "user-id": "user-1",
          "upload-batch-id": "batch-1",
          "photo-id": "photo-1",
        }),
        getPhoto: async () => ({
          photoId: "photo-1",
          userId: "user-1",
          uploadBatchId: "batch-1",
          originalObjectKey: "originals/user-1/batch-1/photo-1",
          processingState: "uploadRequested",
        }),
        markProcessingStarted: async (input) => {
          started.push(input);
        },
        readObjectBytes: async () => Buffer.from("uploaded original bytes"),
        findReadyPhotoBySha256: async ({ userId, sha256, excludePhotoId }) => {
          if (
            userId === "user-1" &&
            sha256 ===
              "acb0eceee37f7978363e33aabc1d415a92e79f9d58bea527d4eae0a8ac1ed3d3" &&
            excludePhotoId === "photo-1"
          ) {
            return { photoId: "already-ready" };
          }
          return undefined;
        },
        markExactDuplicate: async (input) => {
          duplicates.push(input);
        },
        markProcessingFailed: async () => {
          throw new Error("should not fail exact duplicates");
        },
        createDisplayPhoto: async () => {
          throw new Error("should not create display photos for duplicates");
        },
        writeDisplayPhoto: async () => {
          throw new Error("should not write display photos for duplicates");
        },
        markReady: async () => {
          throw new Error("should not mark duplicates ready");
        },
        putTimelineItem: async () => {
          throw new Error("should not write timeline items for duplicates");
        },
      },
    });

    expect(started).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
      },
    ]);
    expect(duplicates).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
        sha256:
          "acb0eceee37f7978363e33aabc1d415a92e79f9d58bea527d4eae0a8ac1ed3d3",
        duplicateOfPhotoId: "already-ready",
      },
    ]);
  });

  it("writes a display JPEG, marks the Photo ready, and creates a lightweight Timeline item", async () => {
    const displayWrites: unknown[] = [];
    const readyWrites: unknown[] = [];
    const timelineWrites: unknown[] = [];

    await handleProcessPhoto({
      records: [
        {
          messageId: "message-1",
          body: JSON.stringify({
            Records: [
              {
                s3: {
                  object: {
                    key: "originals/user-1/batch-1/photo-1",
                  },
                },
              },
            ],
          }),
        },
      ],
      deps: {
        getObjectMetadata: async () => ({
          "user-id": "user-1",
          "upload-batch-id": "batch-1",
          "photo-id": "photo-1",
        }),
        getPhoto: async () => ({
          photoId: "photo-1",
          userId: "user-1",
          uploadBatchId: "batch-1",
          originalObjectKey: "originals/user-1/batch-1/photo-1",
          fileName: "beach.jpg",
          processingState: "uploadRequested",
          uploadRequestedAt: "2026-05-26T01:02:03.000Z",
          fileModifiedAt: "2026-01-02T03:04:05.000Z",
        }),
        markProcessingStarted: async () => undefined,
        readObjectBytes: async () => Buffer.from("jpeg bytes"),
        findReadyPhotoBySha256: async () => undefined,
        createDisplayPhoto: async () => ({
          body: Buffer.from("display jpeg"),
          dimensions: { width: 2048, height: 1365 },
          metadata: {
            width: 3000,
            height: 2000,
            cameraMake: "Fuji",
          },
        }),
        writeDisplayPhoto: async (input) => {
          displayWrites.push(input);
        },
        markReady: async (input) => {
          readyWrites.push(input);
        },
        putTimelineItem: async (input) => {
          timelineWrites.push(input);
        },
        markProcessingFailed: async () => {
          throw new Error("should not fail valid photos");
        },
        markExactDuplicate: async () => {
          throw new Error("should not mark unique photos as duplicates");
        },
      },
    });

    expect(displayWrites).toEqual([
      {
        objectKey: "display/user-1/photo-1.jpg",
        body: Buffer.from("display jpeg"),
      },
    ]);
    expect(readyWrites).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
        sha256:
          "1b48e21282963dfba2ffff3a4c331471242fe42fd0a51161e56df72085c445c9",
        displayObjectKey: "display/user-1/photo-1.jpg",
        displayDimensions: { width: 2048, height: 1365 },
        capturedAt: "2026-01-02T03:04:05.000Z",
        capturedAtSource: "fileModifiedTime",
        metadata: {
          width: 3000,
          height: 2000,
          cameraMake: "Fuji",
        },
      },
    ]);
    expect(timelineWrites).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
        capturedAt: "2026-01-02T03:04:05.000Z",
        fileName: "beach.jpg",
        processingState: "ready",
      },
    ]);
  });

  it("processes custom retry messages from the Retry Processing API", async () => {
    const started: unknown[] = [];

    await handleProcessPhoto({
      records: [
        {
          messageId: "message-1",
          body: JSON.stringify({
            type: "retryPhotoProcessing",
            userId: "user-1",
            photoId: "photo-1",
            originalObjectKey: "originals/user-1/batch-1/photo-1",
          }),
        },
      ],
      deps: {
        getObjectMetadata: async () => ({
          "user-id": "user-1",
          "upload-batch-id": "batch-1",
          "photo-id": "photo-1",
        }),
        getPhoto: async () => ({
          photoId: "photo-1",
          userId: "user-1",
          uploadBatchId: "batch-1",
          originalObjectKey: "originals/user-1/batch-1/photo-1",
          fileName: "retry.jpg",
          processingState: "processingFailed",
          uploadRequestedAt: "2026-05-26T01:02:03.000Z",
        }),
        markProcessingStarted: async (input) => {
          started.push(input);
        },
        readObjectBytes: async () => Buffer.from("retry bytes"),
        findReadyPhotoBySha256: async () => undefined,
        createDisplayPhoto: async () => ({
          body: Buffer.from("display jpeg"),
          dimensions: { width: 100, height: 100 },
          metadata: { width: 100, height: 100 },
        }),
        writeDisplayPhoto: async () => undefined,
        markReady: async () => undefined,
        putTimelineItem: async () => undefined,
        markProcessingFailed: async () => {
          throw new Error("should not fail retry message");
        },
        markExactDuplicate: async () => {
          throw new Error("should not mark retry message duplicate");
        },
      },
    });

    expect(started).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
      },
    ]);
  });
});
