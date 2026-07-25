import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoDbPersonalAlbumStore } from "./dynamodb-store.js";

describe("DynamoDbPersonalAlbumStore commands", () => {
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
