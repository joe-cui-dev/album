import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Handler } from "aws-lambda";
import { config } from "./config.js";
import {
  PHASE_2_MIGRATION_VERSION,
  enqueueMaintenanceWork,
  type MaintenanceWorkItem,
} from "./maintenance.js";

export interface MaintenanceRunRequest {
  dryRun?: boolean;
  migrationVersion?: number;
}

export interface MaintenanceManifest {
  migrationVersion: number;
  legacyFallbackTimeZone: "Australia/Brisbane";
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  queued: number;
  readyPhotos: number;
  failedPhotos: number;
}

interface CoordinatorDeps {
  scanPhotoRecords: () => AsyncIterable<Record<string, unknown>>;
  enqueue: (items: MaintenanceWorkItem[]) => Promise<void>;
  now: () => Date;
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: Handler<MaintenanceRunRequest, MaintenanceManifest> = async (event) =>
  runMaintenanceCoordinator(event ?? {}, {
    scanPhotoRecords: scanPhotoRecords,
    enqueue: enqueueMaintenanceWork,
    now: () => new Date(),
  });

/**
 * Selects all legacy Ready and Processing Failed Photos without mutating them.
 * `dryRun` emits the complete manifest but deliberately sends no queue messages.
 */
export const runMaintenanceCoordinator = async (
  request: MaintenanceRunRequest,
  deps: CoordinatorDeps,
): Promise<MaintenanceManifest> => {
  const migrationVersion = request.migrationVersion ?? PHASE_2_MIGRATION_VERSION;
  if (!Number.isInteger(migrationVersion) || migrationVersion < 1) {
    throw new Error("migrationVersion must be a positive integer");
  }
  const startedAt = deps.now().toISOString();
  const work: MaintenanceWorkItem[] = [];
  let readyPhotos = 0;
  let failedPhotos = 0;
  for await (const photo of deps.scanPhotoRecords()) {
    if (typeof photo.userId !== "string" || typeof photo.photoId !== "string") continue;
    if (photo.processingState === "ready") {
      readyPhotos += 1;
      if (typeof photo.migrationVersion !== "number" || photo.migrationVersion < migrationVersion) {
        work.push({
          type: "backfillReadyPhoto",
          userId: photo.userId,
          photoId: photo.photoId,
          migrationVersion,
        });
      }
    } else if (photo.processingState === "processingFailed") {
      failedPhotos += 1;
      work.push({
        type: "migrateProcessingIssue",
        userId: photo.userId,
        photoId: photo.photoId,
        migrationVersion,
      });
    }
  }
  if (!request.dryRun) await deps.enqueue(work);
  return {
    migrationVersion,
    legacyFallbackTimeZone: "Australia/Brisbane",
    dryRun: request.dryRun === true,
    startedAt,
    completedAt: deps.now().toISOString(),
    queued: work.length,
    readyPhotos,
    failedPhotos,
  };
};

async function* scanPhotoRecords(): AsyncIterable<Record<string, unknown>> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await documentClient.send(new ScanCommand({
      TableName: config.metadataTableName,
      FilterExpression: "begins_with(sk, :photoPrefix)",
      ExpressionAttributeValues: { ":photoPrefix": "PHOTO#" },
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }));
    yield* result.Items ?? [];
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
}
