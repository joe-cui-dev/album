import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "./config.js";

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const manifestKey = (manifestId: string) => ({ pk: "MAINTENANCE", sk: `MIGRATION_MANIFEST#${manifestId}` });

export interface PersistedMigrationManifest {
  manifestId: string;
  migrationVersion: number;
  legacyFallbackTimeZone: "Australia/Brisbane";
  startedAt: string;
  queued: number;
  completed: number;
  failed: number;
  skipped: number;
  dlqEntries: number;
}

export const createMigrationManifest = async (manifest: PersistedMigrationManifest): Promise<void> => {
  await documentClient.send(new PutCommand({
    TableName: config.metadataTableName,
    Item: { ...manifestKey(manifest.manifestId), ...manifest },
    ConditionExpression: "attribute_not_exists(pk)",
  }));
};

export const recordMigrationOutcome = async (
  manifestId: string,
  workId: string,
  outcome: "completed" | "failed" | "skipped" | "dlqEntries",
): Promise<void> => {
  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: config.metadataTableName,
            Item: { pk: `MAINTENANCE#${manifestId}`, sk: `OUTCOME#${workId}`, outcome },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Update: {
            TableName: config.metadataTableName,
            Key: manifestKey(manifestId),
            UpdateExpression: "ADD #outcome :one",
            ExpressionAttributeNames: { "#outcome": outcome },
            ExpressionAttributeValues: { ":one": 1 },
          },
        },
      ],
    }));
  } catch (error) {
    // The same SQS message may redeliver after its outcome transaction commits.
    if (!(error instanceof Error && error.name === "TransactionCanceledException")) throw error;
  }
};

export const recordMigrationEnqueued = async (manifestId: string, workId: string): Promise<void> => {
  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: config.metadataTableName,
            Item: { pk: `MAINTENANCE#${manifestId}`, sk: `ENQUEUED#${workId}` },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Update: {
            TableName: config.metadataTableName,
            Key: manifestKey(manifestId),
            UpdateExpression: "ADD queued :one",
            ExpressionAttributeValues: { ":one": 1 },
          },
        },
      ],
    }));
  } catch (error) {
    if (!(error instanceof Error && error.name === "TransactionCanceledException")) throw error;
  }
};

export const completeMigrationManifest = async (
  manifestId: string,
  completedAt: string,
): Promise<void> => {
  await documentClient.send(new UpdateCommand({
    TableName: config.metadataTableName,
    Key: manifestKey(manifestId),
    UpdateExpression: "SET completedAt = :completedAt",
    ExpressionAttributeValues: { ":completedAt": completedAt },
  }));
};
