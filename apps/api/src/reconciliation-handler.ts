import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Handler } from "aws-lambda";
import { config } from "./config.js";
import { completeMigrationManifest } from "./migration-manifest.js";
import { photoObjectStore } from "./store/configured-store.js";
import { reconcilePhase2Records, reconcileThumbnailObjects, type ReconciliationReport } from "./reconciliation.js";

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Operator-invoked, read-only reconciliation; its response is the run report. */
export const handler: Handler<{ manifestId?: string }, ReconciliationReport> = async (event) => {
  const records: Array<Record<string, unknown>> = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await documentClient.send(new ScanCommand({
      TableName: config.metadataTableName,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }));
    records.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  const report = reconcilePhase2Records(records);
  report.discrepancies.push(...await reconcileThumbnailObjects(records, photoObjectStore));
  if (event?.manifestId) {
    await completeMigrationManifest(event.manifestId, new Date().toISOString());
  }
  console.info(JSON.stringify({ level: "info", message: "Phase 2 reconciliation complete", ...report }));
  return report;
};
