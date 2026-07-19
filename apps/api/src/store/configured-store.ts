import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";
import { createDynamoDbPersonalAlbumStore } from "./dynamodb-store.js";
import { createDynamoDbSignInCodeStore } from "./dynamodb-sign-in-code-store.js";

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const personalAlbumStore = createDynamoDbPersonalAlbumStore({
  documentClient,
  tableName: config.metadataTableName,
});

export const signInCodeStore = createDynamoDbSignInCodeStore({
  documentClient,
  tableName: config.metadataTableName,
});
