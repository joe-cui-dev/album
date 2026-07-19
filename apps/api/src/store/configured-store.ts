import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { createDynamoDbPersonalAlbumStore } from "./dynamodb-store.js";

export const personalAlbumStore = createDynamoDbPersonalAlbumStore({
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName: config.metadataTableName,
});
