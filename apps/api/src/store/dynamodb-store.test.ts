import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoDbPersonalAlbumStore } from "./dynamodb-store.js";

describe("DynamoDbPersonalAlbumStore commands", () => {
  it("uses scoped keys and writes a ready Photo before its Timeline item", async () => {
    const commands: Array<{ input: Record<string, unknown> }> = [];
    const documentClient = {
      send: async (command: { input: Record<string, unknown> }) => {
        commands.push(command);
        return {};
      },
    } as unknown as DynamoDBDocumentClient;
    const album = createDynamoDbPersonalAlbumStore({
      documentClient,
      tableName: "metadata-table",
    }).personalAlbumOf("user-1");

    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "beach.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
    });
    await album.createUploadBatch({
      uploadBatchId: "batch-1",
      createdAt: "2026-07-19T00:00:00.000Z",
      photoIds: ["photo-1"],
    });
    await album.markProcessingStarted("photo-1");
    await album.markReady({
      photoId: "photo-1",
      sha256: "abc",
      fileName: "beach.jpg",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: { width: 100, height: 50 },
      timelineThumbnailObjectKey: "timeline-thumbnails/user-1/photo-1.jpg",
      timelineThumbnailDimensions: { width: 50, height: 25 },
      capturedAt: "2026-01-02T00:00:00.000Z",
      capturedAtSource: "exif",
      metadata: { width: 100, height: 50 },
    });

    expect(commands.map((command) => command.input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Item: expect.objectContaining({ pk: "USER#user-1", sk: "PHOTO#photo-1" }),
        }),
        expect.objectContaining({
          Item: expect.objectContaining({
            pk: "USER#user-1",
            sk: "UPLOAD_BATCH#batch-1",
          }),
        }),
        expect.objectContaining({
          UpdateExpression:
            "SET processingState = :state REMOVE failureCode, failureMessage",
        }),
        expect.objectContaining({
          UpdateExpression: expect.stringContaining("REMOVE failureCode, failureMessage"),
        }),
        expect.objectContaining({
          Item: {
            pk: "USER#user-1",
            sk: "TIMELINE#2026-01-02T00:00:00.000Z#photo-1",
            userId: "user-1",
            photoId: "photo-1",
            capturedAt: "2026-01-02T00:00:00.000Z",
            fileName: "beach.jpg",
            processingState: "ready",
          },
        }),
      ]),
    );
    const readyUpdate = commands.find((command) =>
      String(command.input.UpdateExpression).includes("displayObjectKey"),
    );
    const timelineWrite = commands.find(
      (command) => (command.input.Item as { sk?: string } | undefined)?.sk?.startsWith("TIMELINE#"),
    );
    expect(commands.indexOf(readyUpdate!)).toBeLessThan(commands.indexOf(timelineWrite!));
  });

  it("retries unprocessed BatchGet keys until every requested Photo is resolved", async () => {
    let batchGets = 0;
    const documentClient = {
      send: async (command: { input: Record<string, unknown> }) => {
        batchGets += 1;
        return batchGets === 1
          ? { Responses: { metadata: [] }, UnprocessedKeys: { metadata: { Keys: [{ pk: "USER#user-1", sk: "PHOTO#photo-1" }] } } }
          : { Responses: { metadata: [] } };
      },
    } as unknown as DynamoDBDocumentClient;
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata" }).personalAlbumOf("user-1");

    await album.getPhotosByIds(["photo-1"]);

    expect(batchGets).toBe(2);
  });
});
