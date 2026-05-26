import { describe, it } from "@jest/globals";
import assert from "node:assert/strict";
import { handleGetUploadBatchStatus } from "./upload-batch-status.js";

describe("handleGetUploadBatchStatus", () => {
  it("returns counts and lightweight per-photo status for the signed-in user's batch", async () => {
    const response = await handleGetUploadBatchStatus({
      user: { userId: "user-1", email: "user@example.com" },
      uploadBatchId: "batch-1",
      deps: {
        getItem: async ({ sk }) => {
          if (sk === "UPLOAD_BATCH#batch-1") {
            return {
              uploadBatchId: "batch-1",
              userId: "user-1",
              photoIds: ["photo-1", "photo-2", "photo-3"],
            };
          }
          if (sk === "PHOTO#photo-1") {
            return {
              photoId: "photo-1",
              fileName: "ready.jpg",
              processingState: "ready",
              originalObjectKey: "originals/user-1/batch-1/photo-1",
              displayObjectKey: "display/user-1/photo-1.jpg",
            };
          }
          if (sk === "PHOTO#photo-2") {
            return {
              photoId: "photo-2",
              fileName: "duplicate.jpg",
              processingState: "exactDuplicate",
              originalObjectKey: "originals/user-1/batch-1/photo-2",
            };
          }
          if (sk === "PHOTO#photo-3") {
            return {
              photoId: "photo-3",
              fileName: "broken.heic",
              processingState: "processingFailed",
              failureCode: "unsupportedImage",
              failureMessage: "We couldn't process this photo.",
              originalObjectKey: "originals/user-1/batch-1/photo-3",
            };
          }
          return undefined;
        },
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body ?? "{}");
    assert.deepEqual(body, {
      uploadBatchId: "batch-1",
      counts: {
        uploadRequested: 0,
        uploaded: 0,
        processing: 0,
        ready: 1,
        processingFailed: 1,
        exactDuplicate: 1,
      },
      photos: [
        {
          photoId: "photo-1",
          fileName: "ready.jpg",
          processingState: "ready",
          exactDuplicate: false,
        },
        {
          photoId: "photo-2",
          fileName: "duplicate.jpg",
          processingState: "exactDuplicate",
          exactDuplicate: true,
        },
        {
          photoId: "photo-3",
          fileName: "broken.heic",
          processingState: "processingFailed",
          exactDuplicate: false,
          failureCode: "unsupportedImage",
          failureMessage: "We couldn't process this photo.",
        },
      ],
    });
    assert.equal(JSON.stringify(body).includes("originalObjectKey"), false);
    assert.equal(JSON.stringify(body).includes("displayObjectKey"), false);
  });
});
