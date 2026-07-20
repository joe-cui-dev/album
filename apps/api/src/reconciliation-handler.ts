import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Handler } from "aws-lambda";
import { config } from "./config.js";
import { reconcilePhase2Records, type ReconciliationReport } from "./reconciliation.js";

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Operator-invoked, read-only reconciliation; its response is the run report. */
export const handler: Handler<Record<string, never>, ReconciliationReport> = async () => {
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
  console.info(JSON.stringify({ level: "info", message: "Phase 2 reconciliation complete", ...report }));
  return report;
};
