import sharp from "sharp";
import {
  createDisplayPhoto,
  createTimelineThumbnail,
  handleProcessPhoto,
} from "./process-photo.js";

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
        createTimelineThumbnail: async () => {
          throw new Error("should not create timeline thumbnails for mismatches");
        },
        writeDisplayPhoto: async () => {
          throw new Error("should not write display photos for mismatches");
        },
        writeTimelineThumbnail: async () => {
          throw new Error("should not write timeline thumbnails for mismatches");
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
        createTimelineThumbnail: async () => {
          throw new Error("should not create timeline thumbnails for duplicates");
        },
        writeDisplayPhoto: async () => {
          throw new Error("should not write display photos for duplicates");
        },
        writeTimelineThumbnail: async () => {
          throw new Error("should not write timeline thumbnails for duplicates");
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

  it("writes derived JPEGs, marks the Photo ready, and creates a lightweight Timeline item", async () => {
    const displayWrites: unknown[] = [];
    const timelineThumbnailWrites: unknown[] = [];
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
        createTimelineThumbnail: async () => ({
          body: Buffer.from("timeline thumbnail jpeg"),
          dimensions: { width: 320, height: 213 },
        }),
        writeDisplayPhoto: async (input) => {
          displayWrites.push(input);
        },
        writeTimelineThumbnail: async (input) => {
          timelineThumbnailWrites.push(input);
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
    expect(timelineThumbnailWrites).toEqual([
      {
        objectKey: "timeline-thumbnails/user-1/photo-1.jpg",
        body: Buffer.from("timeline thumbnail jpeg"),
      },
    ]);
    expect(readyWrites).toEqual([
      {
        userId: "user-1",
        photoId: "photo-1",
        fileName: "beach.jpg",
        sha256:
          "1b48e21282963dfba2ffff3a4c331471242fe42fd0a51161e56df72085c445c9",
        displayObjectKey: "display/user-1/photo-1.jpg",
        displayDimensions: { width: 2048, height: 1365 },
        timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg",
        timelineThumbnailDimensions: { width: 320, height: 213 },
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

  it("uses EXIF captured time from decoded photo metadata before file modified time", async () => {
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
          fileName: "exif.jpg",
          processingState: "uploadRequested",
          uploadRequestedAt: "2026-05-26T01:02:03.000Z",
          fileModifiedAt: "2026-01-02T03:04:05.000Z",
        }),
        markProcessingStarted: async () => undefined,
        readObjectBytes: async () => Buffer.from("jpeg bytes"),
        findReadyPhotoBySha256: async () => undefined,
        createDisplayPhoto: async () => ({
          body: Buffer.from("display jpeg"),
          dimensions: { width: 1200, height: 800 },
          metadata: { width: 1200, height: 800 },
          capturedAt: "2025-12-24T10:11:12.000Z",
        }),
        createTimelineThumbnail: async () => ({
          body: Buffer.from("timeline thumbnail jpeg"),
          dimensions: { width: 320, height: 213 },
        }),
        writeDisplayPhoto: async () => undefined,
        writeTimelineThumbnail: async () => undefined,
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

    expect(readyWrites).toMatchObject([
      {
        capturedAt: "2025-12-24T10:11:12.000Z",
        capturedAtSource: "exif",
      },
    ]);
    expect(timelineWrites).toMatchObject([
      {
        capturedAt: "2025-12-24T10:11:12.000Z",
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
        createTimelineThumbnail: async () => ({
          body: Buffer.from("timeline thumbnail jpeg"),
          dimensions: { width: 100, height: 100 },
        }),
        writeDisplayPhoto: async () => undefined,
        writeTimelineThumbnail: async () => undefined,
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

describe("createDisplayPhoto", () => {
  it("extracts captured time, camera, lens, location, and oriented display dimensions from EXIF", async () => {
    const original = await sharp({
      create: {
        width: 16,
        height: 8,
        channels: 3,
        background: "#6699cc",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: {
          Make: "Fuji",
          Model: "X100V",
        },
        IFD2: {
          DateTimeOriginal: "2025:12:24 10:11:12",
          LensModel: "23mm F2",
        },
        IFD3: {
          GPSLatitudeRef: "S",
          GPSLatitude: "27/1 28/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "153/1 1/1 0/1",
        },
      })
      .toBuffer();

    const result = await createDisplayPhoto(original);

    expect(result.capturedAt).toBe("2025-12-24T10:11:12.000Z");
    expect(result.metadata).toEqual({
      width: 16,
      height: 8,
      cameraMake: "Fuji",
      cameraModel: "X100V",
      lensModel: "23mm F2",
      location: {
        latitude: -27.466666666666665,
        longitude: 153.01666666666668,
      },
    });
    expect(result.dimensions).toEqual({ width: 8, height: 16 });
    await expect(sharp(result.body).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 8,
      height: 16,
    });
  });

  it("writes display photos as JPEG with longest edge constrained to 2048 pixels without enlarging small images", async () => {
    const largeOriginal = await sharp({
      create: {
        width: 4096,
        height: 1024,
        channels: 3,
        background: "#cc9966",
      },
    })
      .png()
      .toBuffer();
    const smallOriginal = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: "#99cc66",
      },
    })
      .jpeg()
      .toBuffer();

    const largeResult = await createDisplayPhoto(largeOriginal);
    const smallResult = await createDisplayPhoto(smallOriginal);

    await expect(sharp(largeResult.body).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 2048,
      height: 512,
    });
    expect(largeResult.dimensions).toEqual({ width: 2048, height: 512 });

    await expect(sharp(smallResult.body).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 32,
      height: 16,
    });
    expect(smallResult.dimensions).toEqual({ width: 32, height: 16 });
  });
});

describe("createTimelineThumbnail", () => {
  it("writes timeline thumbnails as JPEG with longest edge constrained to 320 pixels without enlarging small images", async () => {
    const largeOriginal = await sharp({
      create: {
        width: 4096,
        height: 1024,
        channels: 3,
        background: "#6699cc",
      },
    })
      .png()
      .toBuffer();
    const smallOriginal = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: "#99cc66",
      },
    })
      .jpeg()
      .toBuffer();

    const largeResult = await createTimelineThumbnail(largeOriginal);
    const smallResult = await createTimelineThumbnail(smallOriginal);

    await expect(sharp(largeResult.body).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 320,
      height: 80,
    });
    expect(largeResult.dimensions).toEqual({ width: 320, height: 80 });

    await expect(sharp(smallResult.body).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 32,
      height: 16,
    });
    expect(smallResult.dimensions).toEqual({ width: 32, height: 16 });
  });
});
