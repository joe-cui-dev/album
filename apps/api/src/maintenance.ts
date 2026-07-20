import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent, SQSHandler } from "aws-lambda";
import {
  buildTimelineThumbnailLargeObjectKey,
  buildTimelineThumbnailObjectKey,
  parseOriginalObjectKey,
  type Dimensions,
} from "@album/shared";
import sharp from "sharp";
import {
  LEGACY_FALLBACK_TIME_ZONE,
  deriveLocalDateTime,
  resolveOriginalCapturedAt,
} from "./chronology-extraction.js";
import { config } from "./config.js";
import { personalAlbumStore, photoObjectStore } from "./store/configured-store.js";
import type { PersonalAlbumStore } from "./store/personal-album.js";
import type { PhotoObjectStore } from "./store/photo-objects.js";
import {
  createTimelineThumbnail,
  createTimelineThumbnailLarge,
  createDisplayPhoto,
} from "./handlers/process-photo.js";

/** The explicit rollout revision recorded on every migrated Photo. */
export const PHASE_2_MIGRATION_VERSION = 1;

export interface MaintenanceWorkItem {
  type: "backfillReadyPhoto" | "migrateProcessingIssue";
  userId: string;
  photoId: string;
  migrationVersion: number;
}

interface MaintenanceDeps {
  store: PersonalAlbumStore;
  photoObjects: PhotoObjectStore;
  now: () => Date;
}

/**
 * Runs a single idempotent maintenance item. It only reads the Original once,
 * never writes a Display Photo, and leaves non-Ready Photos untouched.
 */
export const maintainPhoto = async (
  item: MaintenanceWorkItem,
  deps: MaintenanceDeps,
): Promise<"completed" | "skipped"> => {
  const album = deps.store.personalAlbumOf(item.userId);
  const photo = await album.getPhoto(item.photoId);
  if (!photo) return "skipped";

  if (item.type === "migrateProcessingIssue") {
    if (photo.processingState !== "processingFailed") return "skipped";
    await album.recordProcessingIssueV2({
      photoId: photo.photoId,
      fileName: photo.fileName,
      reasonCode: photo.failureCode ?? "legacyProcessingFailure",
      attemptedAt: deps.now().toISOString(),
    });
    return "completed";
  }

  if (photo.processingState !== "ready") return "skipped";
  if ((photo.migrationVersion ?? 0) >= item.migrationVersion) return "skipped";
  const keyParts = parseOriginalObjectKey(photo.originalObjectKey);
  if (!keyParts || keyParts.userId !== item.userId || keyParts.photoId !== item.photoId) {
    throw new Error(`Photo ${item.photoId} has an invalid Original Photo key`);
  }

  const original = await deps.photoObjects.readObjectBytes(photo.originalObjectKey);
  // This extracts EXIF candidates from the Original only; its generated display
  // buffer is deliberately not persisted during maintenance.
  const extracted = await createDisplayPhoto(original);
  const originalCapturedAt = resolveOriginalCapturedAt({
    ...(extracted.exifOriginal ? { exifOriginal: extracted.exifOriginal } : {}),
    ...(extracted.exifDigitized ? { exifDigitized: extracted.exifDigitized } : {}),
    ...(photo.fileModifiedLocalDateTime
      ? { fileModifiedLocalDateTime: parseLocalDateTime(photo.fileModifiedLocalDateTime) }
      : photo.fileModifiedAt
        ? { fileModifiedLocalDateTime: deriveLocalDateTime(photo.fileModifiedAt, LEGACY_FALLBACK_TIME_ZONE) }
        : {}),
    uploadLocalDateTime: photo.uploadLocalDateTime
      ? parseLocalDateTime(photo.uploadLocalDateTime)
      : deriveLocalDateTime(photo.uploadRequestedAt ?? new Date(0).toISOString(), LEGACY_FALLBACK_TIME_ZONE),
  });

  const smallKey = buildTimelineThumbnailObjectKey(keyParts);
  const largeKey = buildTimelineThumbnailLargeObjectKey(keyParts);
  const existingSmall = await readValidJpeg(deps.photoObjects, smallKey);
  const small = existingSmall ?? await createTimelineThumbnail(original);
  if (!existingSmall) {
    await deps.photoObjects.writeJpegObject({ objectKey: smallKey, body: small.body });
  }
  const large = await createTimelineThumbnailLarge(original);
  await deps.photoObjects.writeJpegObject({ objectKey: largeKey, body: large.body });

  await album.applyMigrationVersionV2({
    photoId: photo.photoId,
    migrationVersion: item.migrationVersion,
    originalCapturedAt: originalCapturedAt.capturedAt,
    originalCapturedAtSource: originalCapturedAt.source,
    timelineThumbnails: {
      small: { objectKey: smallKey, dimensions: small.dimensions },
      large: { objectKey: largeKey, dimensions: large.dimensions },
    },
  });
  return "completed";
};

const parseLocalDateTime = (value: string): { localDate: string; localTime: string } => {
  const [localDate, localTime] = value.split("T");
  return { localDate: localDate ?? value, localTime: localTime ?? "00:00:00" };
};

const readValidJpeg = async (
  photoObjects: PhotoObjectStore,
  objectKey: string,
): Promise<{ body: Uint8Array; dimensions: Dimensions } | undefined> => {
  try {
    const body = await photoObjects.readObjectBytes(objectKey);
    const metadata = await sharp(body).metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) return undefined;
    return { body, dimensions: { width: metadata.width, height: metadata.height } };
  } catch {
    return undefined;
  }
};

export const maintenanceWorkerHandler: SQSHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const item = JSON.parse(record.body) as MaintenanceWorkItem;
      if (
        (item.type !== "backfillReadyPhoto" && item.type !== "migrateProcessingIssue") ||
        typeof item.userId !== "string" ||
        typeof item.photoId !== "string" ||
        !Number.isInteger(item.migrationVersion)
      ) {
        throw new Error("Invalid photo maintenance message");
      }
      await maintainPhoto(item, {
        store: personalAlbumStore,
        photoObjects: photoObjectStore,
        now: () => new Date(),
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Photo maintenance item failed",
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};

/** Sends maintenance work only after the caller has selected the immutable target list. */
export const enqueueMaintenanceWork = async (items: MaintenanceWorkItem[]): Promise<void> => {
  if (!config.photoMaintenanceQueueUrl) {
    throw new Error("Missing PHOTO_MAINTENANCE_QUEUE_URL");
  }
  const sqs = new SQSClient({});
  for (const item of items) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: config.photoMaintenanceQueueUrl,
      MessageBody: JSON.stringify(item),
    }));
  }
};
