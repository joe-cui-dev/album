import type { SQSEvent, SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  CapturedAtSource,
  PhotoMetadata,
  ProcessingState,
} from "@album/shared";
import {
  displayPhotoLongestEdgePixels,
  parseOriginalObjectKey,
  timelineThumbnailLongestEdgePixels,
} from "@album/shared";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { config } from "../config.js";

const s3 = new S3Client({});
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ProcessRecord {
  messageId: string;
  body: string;
}

interface PhotoProcessingItem {
  photoId: string;
  userId: string;
  uploadBatchId: string;
  originalObjectKey: string;
  fileName?: string;
  fileModifiedAt?: string;
  uploadRequestedAt?: string;
  processingState: ProcessingState;
}

interface DerivedPhotoResult {
  body: Uint8Array;
  dimensions: {
    width: number;
    height: number;
  };
}

interface DisplayPhotoResult extends DerivedPhotoResult {
  metadata: PhotoMetadata;
  capturedAt?: string;
}

interface ProcessPhotoDeps {
  getObjectMetadata: (
    objectKey: string,
  ) => Promise<Record<string, string | undefined>>;
  getPhoto: (input: {
    userId: string;
    photoId: string;
  }) => Promise<PhotoProcessingItem | undefined>;
  markProcessingFailed: (input: {
    userId: string;
    photoId: string;
    failureCode: string;
    failureMessage: string;
  }) => Promise<void>;
  markProcessingStarted: (input: {
    userId: string;
    photoId: string;
  }) => Promise<void>;
  readObjectBytes: (objectKey: string) => Promise<Uint8Array>;
  findReadyPhotoBySha256: (input: {
    userId: string;
    sha256: string;
    excludePhotoId: string;
  }) => Promise<{ photoId: string } | undefined>;
  markExactDuplicate: (input: {
    userId: string;
    photoId: string;
    sha256: string;
    duplicateOfPhotoId: string;
  }) => Promise<void>;
  createDisplayPhoto: (originalBytes: Uint8Array) => Promise<DisplayPhotoResult>;
  createTimelineThumbnail: (
    originalBytes: Uint8Array,
  ) => Promise<DerivedPhotoResult>;
  writeDisplayPhoto: (input: {
    objectKey: string;
    body: Uint8Array;
  }) => Promise<void>;
  writeTimelineThumbnail: (input: {
    objectKey: string;
    body: Uint8Array;
  }) => Promise<void>;
  markReady: (input: {
    userId: string;
    photoId: string;
    sha256: string;
    displayObjectKey: string;
    displayDimensions: {
      width: number;
      height: number;
    };
    timelineThumbnailObjectKey: string;
    timelineThumbnailDimensions: {
      width: number;
      height: number;
    };
    capturedAt: string;
    capturedAtSource: CapturedAtSource;
    metadata: PhotoMetadata;
  }) => Promise<void>;
  putTimelineItem: (input: {
    userId: string;
    photoId: string;
    capturedAt: string;
    fileName: string;
    processingState: "ready";
  }) => Promise<void>;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  await handleProcessPhoto({
    records: event.Records,
    deps: {
      getObjectMetadata: async (objectKey) => {
        const result = await s3.send(
          new HeadObjectCommand({
            Bucket: config.photosBucketName,
            Key: objectKey,
          }),
        );
        return result.Metadata ?? {};
      },
      getPhoto: async ({ userId, photoId }) => {
        const result = await dynamodb.send(
          new GetCommand({
            TableName: config.metadataTableName,
            Key: {
              pk: `USER#${userId}`,
              sk: `PHOTO#${photoId}`,
            },
          }),
        );
        return asPhotoProcessingItem(result.Item);
      },
      markProcessingFailed: async ({
        userId,
        photoId,
        failureCode,
        failureMessage,
      }) => {
        await dynamodb.send(
          new UpdateCommand({
            TableName: config.metadataTableName,
            Key: {
              pk: `USER#${userId}`,
              sk: `PHOTO#${photoId}`,
            },
            UpdateExpression:
              "SET processingState = :state, failureCode = :code, failureMessage = :message",
            ExpressionAttributeValues: {
              ":state": "processingFailed",
              ":code": failureCode,
              ":message": failureMessage,
            },
          }),
        );
      },
      markProcessingStarted: async ({ userId, photoId }) => {
        await dynamodb.send(
          new UpdateCommand({
            TableName: config.metadataTableName,
            Key: {
              pk: `USER#${userId}`,
              sk: `PHOTO#${photoId}`,
            },
            UpdateExpression:
              "SET processingState = :state REMOVE failureCode, failureMessage",
            ExpressionAttributeValues: {
              ":state": "processing",
            },
          }),
        );
      },
      readObjectBytes: async (objectKey) => {
        const result = await s3.send(
          new GetObjectCommand({
            Bucket: config.photosBucketName,
            Key: objectKey,
          }),
        );
        if (!result.Body) {
          return new Uint8Array();
        }
        return result.Body.transformToByteArray();
      },
      findReadyPhotoBySha256: async ({ userId, sha256, excludePhotoId }) => {
        const result = await dynamodb.send(
          new QueryCommand({
            TableName: config.metadataTableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :photo)",
            FilterExpression:
              "sha256 = :sha256 AND processingState = :ready AND photoId <> :photoId",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":photo": "PHOTO#",
              ":sha256": sha256,
              ":ready": "ready",
              ":photoId": excludePhotoId,
            },
            Limit: 1,
          }),
        );
        const item = result.Items?.[0];
        return typeof item?.photoId === "string"
          ? { photoId: item.photoId }
          : undefined;
      },
      markExactDuplicate: async ({
        userId,
        photoId,
        sha256,
        duplicateOfPhotoId,
      }) => {
        await dynamodb.send(
          new UpdateCommand({
            TableName: config.metadataTableName,
            Key: {
              pk: `USER#${userId}`,
              sk: `PHOTO#${photoId}`,
            },
            UpdateExpression:
              "SET processingState = :state, sha256 = :sha256, duplicateOfPhotoId = :duplicateOfPhotoId REMOVE failureCode, failureMessage",
            ExpressionAttributeValues: {
              ":state": "exactDuplicate",
              ":sha256": sha256,
              ":duplicateOfPhotoId": duplicateOfPhotoId,
            },
          }),
        );
      },
      createDisplayPhoto,
      createTimelineThumbnail,
      writeDisplayPhoto: async ({ objectKey, body }) => {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.photosBucketName,
            Key: objectKey,
            Body: body,
            ContentType: "image/jpeg",
          }),
        );
      },
      writeTimelineThumbnail: async ({ objectKey, body }) => {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.photosBucketName,
            Key: objectKey,
            Body: body,
            ContentType: "image/jpeg",
          }),
        );
      },
      markReady: async ({
        userId,
        photoId,
        sha256,
        displayObjectKey,
        displayDimensions,
        timelineThumbnailObjectKey,
        timelineThumbnailDimensions,
        capturedAt,
        capturedAtSource,
        metadata,
      }) => {
        await dynamodb.send(
          new UpdateCommand({
            TableName: config.metadataTableName,
            Key: {
              pk: `USER#${userId}`,
              sk: `PHOTO#${photoId}`,
            },
            UpdateExpression:
              "SET processingState = :state, sha256 = :sha256, displayObjectKey = :displayObjectKey, displayDimensions = :displayDimensions, timelineThumbnailObjectKey = :timelineThumbnailObjectKey, timelineThumbnailDimensions = :timelineThumbnailDimensions, capturedAt = :capturedAt, capturedAtSource = :capturedAtSource, #metadata = :metadata REMOVE failureCode, failureMessage",
            ExpressionAttributeNames: {
              "#metadata": "metadata",
            },
            ExpressionAttributeValues: {
              ":state": "ready",
              ":sha256": sha256,
              ":displayObjectKey": displayObjectKey,
              ":displayDimensions": displayDimensions,
              ":timelineThumbnailObjectKey": timelineThumbnailObjectKey,
              ":timelineThumbnailDimensions": timelineThumbnailDimensions,
              ":capturedAt": capturedAt,
              ":capturedAtSource": capturedAtSource,
              ":metadata": metadata,
            },
          }),
        );
      },
      putTimelineItem: async ({
        userId,
        photoId,
        capturedAt,
        fileName,
        processingState,
      }) => {
        await dynamodb.send(
          new PutCommand({
            TableName: config.metadataTableName,
            Item: {
              pk: `USER#${userId}`,
              sk: `TIMELINE#${capturedAt}#${photoId}`,
              userId,
              photoId,
              capturedAt,
              fileName,
              processingState,
            },
          }),
        );
      },
    },
  });
};

export const handleProcessPhoto = async ({
  records,
  deps,
}: {
  records: ProcessRecord[];
  deps: ProcessPhotoDeps;
}): Promise<void> => {
  for (const record of records) {
    const objectKeys = extractS3ObjectKeys(record.body);
    for (const objectKey of objectKeys) {
      const keyParts = parseOriginalObjectKey(objectKey);
      if (!keyParts) {
        logInfo("Ignoring photo processing message with invalid object key", {
          messageId: record.messageId,
          objectKey,
        });
        continue;
      }

      const metadata = await deps.getObjectMetadata(objectKey);
      if (!metadataMatchesKey(metadata, keyParts)) {
        const photo = await deps.getPhoto({
          userId: keyParts.userId,
          photoId: keyParts.photoId,
        });
        if (photo) {
          await deps.markProcessingFailed({
            userId: keyParts.userId,
            photoId: keyParts.photoId,
            failureCode: "metadataMismatch",
            failureMessage: "We couldn't verify this upload. Please try again.",
          });
        } else {
          logInfo("Ignoring photo processing message with no matching Photo", {
            messageId: record.messageId,
            objectKey,
          });
        }
        continue;
      }

      const photo = await deps.getPhoto({
        userId: keyParts.userId,
        photoId: keyParts.photoId,
      });
      if (!photo) {
        logInfo("Ignoring photo processing message with no matching Photo", {
          messageId: record.messageId,
          objectKey,
        });
        continue;
      }
      if (
        photo.processingState !== "uploadRequested" &&
        photo.processingState !== "processingFailed"
      ) {
        logInfo("Ignoring photo processing message for non-processable Photo", {
          messageId: record.messageId,
          objectKey,
          processingState: photo.processingState,
        });
        continue;
      }

      await deps.markProcessingStarted({
        userId: keyParts.userId,
        photoId: keyParts.photoId,
      });
      const originalBytes = await deps.readObjectBytes(objectKey);
      const sha256 = createHash("sha256").update(originalBytes).digest("hex");
      const duplicate = await deps.findReadyPhotoBySha256({
        userId: keyParts.userId,
        sha256,
        excludePhotoId: keyParts.photoId,
      });
      if (duplicate) {
        await deps.markExactDuplicate({
          userId: keyParts.userId,
          photoId: keyParts.photoId,
          sha256,
          duplicateOfPhotoId: duplicate.photoId,
        });
        continue;
      }

      let displayPhoto: DisplayPhotoResult;
      let timelineThumbnail: DerivedPhotoResult;
      try {
        displayPhoto = await deps.createDisplayPhoto(originalBytes);
        timelineThumbnail = await deps.createTimelineThumbnail(originalBytes);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "Failed to create derived photo output",
            objectKey,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        await deps.markProcessingFailed({
          userId: keyParts.userId,
          photoId: keyParts.photoId,
          failureCode: "unsupportedImage",
          failureMessage: "We couldn't process this photo.",
        });
        continue;
      }

      const displayObjectKey = `display/${keyParts.userId}/${keyParts.photoId}.jpg`;
      const timelineThumbnailObjectKey = `timeline-thumbnails/${keyParts.userId}/${keyParts.photoId}.jpg`;
      const capturedAt = resolveCapturedAt(photo, displayPhoto);
      await deps.writeDisplayPhoto({
        objectKey: displayObjectKey,
        body: displayPhoto.body,
      });
      await deps.writeTimelineThumbnail({
        objectKey: timelineThumbnailObjectKey,
        body: timelineThumbnail.body,
      });
      await deps.markReady({
        userId: keyParts.userId,
        photoId: keyParts.photoId,
        sha256,
        displayObjectKey,
        displayDimensions: displayPhoto.dimensions,
        timelineThumbnailObjectKey,
        timelineThumbnailDimensions: timelineThumbnail.dimensions,
        capturedAt: capturedAt.value,
        capturedAtSource: capturedAt.source,
        metadata: displayPhoto.metadata,
      });
      await deps.putTimelineItem({
        userId: keyParts.userId,
        photoId: keyParts.photoId,
        capturedAt: capturedAt.value,
        fileName: photo.fileName ?? keyParts.photoId,
        processingState: "ready",
      });
    }
  }
};

const extractS3ObjectKeys = (body: string): string[] => {
  try {
    const parsed = JSON.parse(body) as {
      type?: string;
      userId?: string;
      photoId?: string;
      originalObjectKey?: string;
      Records?: Array<{ s3?: { object?: { key?: string } } }>;
    };

    if (
      parsed.type === "retryPhotoProcessing" &&
      typeof parsed.userId === "string" &&
      typeof parsed.photoId === "string" &&
      typeof parsed.originalObjectKey === "string"
    ) {
      const keyParts = parseOriginalObjectKey(parsed.originalObjectKey);
      if (
        keyParts?.userId === parsed.userId &&
        keyParts.photoId === parsed.photoId
      ) {
        return [parsed.originalObjectKey];
      }
      return [];
    }

    return (
      parsed.Records?.map((record) => record.s3?.object?.key)
        .filter((key): key is string => Boolean(key))
        .map((key) => decodeURIComponent(key.replace(/\+/g, " "))) ?? []
    );
  } catch {
    return [];
  }
};

const metadataMatchesKey = (
  metadata: Record<string, string | undefined>,
  keyParts: NonNullable<ReturnType<typeof parseOriginalObjectKey>>,
): boolean => {
  return (
    metadata["user-id"] === keyParts.userId &&
    metadata["upload-batch-id"] === keyParts.uploadBatchId &&
    metadata["photo-id"] === keyParts.photoId
  );
};

const asPhotoProcessingItem = (
  item: Record<string, unknown> | undefined,
): PhotoProcessingItem | undefined => {
  if (
    !item ||
    typeof item.photoId !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.uploadBatchId !== "string" ||
    typeof item.originalObjectKey !== "string" ||
    typeof item.processingState !== "string"
  ) {
    return undefined;
  }
  return item as unknown as PhotoProcessingItem;
};

interface ParsedExif {
  capturedAt?: string;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export const createDisplayPhoto = async (
  originalBytes: Uint8Array,
): Promise<DisplayPhotoResult> => {
  const sourceMetadata = await sharp(originalBytes).metadata();
  const exif = parseExif(sourceMetadata.exif);
  const rendered = await sharp(originalBytes)
    .rotate()
    .resize({
      width: displayPhotoLongestEdgePixels,
      height: displayPhotoLongestEdgePixels,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  return {
    body: rendered.data,
    dimensions: {
      width: rendered.info.width,
      height: rendered.info.height,
    },
    metadata: {
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      ...(exif.cameraMake ? { cameraMake: exif.cameraMake } : {}),
      ...(exif.cameraModel ? { cameraModel: exif.cameraModel } : {}),
      ...(exif.lensModel ? { lensModel: exif.lensModel } : {}),
      ...(exif.location ? { location: exif.location } : {}),
    },
    ...(exif.capturedAt ? { capturedAt: exif.capturedAt } : {}),
  };
};

export const createTimelineThumbnail = async (
  originalBytes: Uint8Array,
): Promise<DerivedPhotoResult> => {
  const rendered = await sharp(originalBytes)
    .rotate()
    .resize({
      width: timelineThumbnailLongestEdgePixels,
      height: timelineThumbnailLongestEdgePixels,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  return {
    body: rendered.data,
    dimensions: {
      width: rendered.info.width,
      height: rendered.info.height,
    },
  };
};

const parseExif = (exif: Buffer | undefined): ParsedExif => {
  if (
    !exif ||
    exif.length < 14 ||
    exif.toString("ascii", 0, 6) !== "Exif\0\0"
  ) {
    return {};
  }

  const tiffStart = 6;
  const byteOrder = exif.toString("ascii", tiffStart, tiffStart + 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    return {};
  }

  const readUInt16 = (offset: number): number =>
    littleEndian ? exif.readUInt16LE(offset) : exif.readUInt16BE(offset);
  const readUInt32 = (offset: number): number =>
    littleEndian ? exif.readUInt32LE(offset) : exif.readUInt32BE(offset);
  const absoluteOffset = (relativeOffset: number): number =>
    tiffStart + relativeOffset;

  if (readUInt16(tiffStart + 2) !== 42) {
    return {};
  }

  const readIfd = (relativeOffset: number): Map<number, ExifEntry> => {
    const entries = new Map<number, ExifEntry>();
    const ifdOffset = absoluteOffset(relativeOffset);
    if (ifdOffset < 0 || ifdOffset + 2 > exif.length) {
      return entries;
    }

    const entryCount = readUInt16(ifdOffset);
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12;
      if (entryOffset + 12 > exif.length) {
        break;
      }
      entries.set(readUInt16(entryOffset), {
        type: readUInt16(entryOffset + 2),
        count: readUInt32(entryOffset + 4),
        valueOffset: entryOffset + 8,
      });
    }
    return entries;
  };

  const readAscii = (entry: ExifEntry | undefined): string | undefined => {
    if (!entry || entry.type !== 2 || entry.count === 0) {
      return undefined;
    }
    const byteLength = entry.count;
    const valueOffset =
      byteLength <= 4
        ? entry.valueOffset
        : absoluteOffset(readUInt32(entry.valueOffset));
    if (valueOffset < 0 || valueOffset + byteLength > exif.length) {
      return undefined;
    }
    const value = exif
      .toString("utf8", valueOffset, valueOffset + byteLength)
      .replace(/\0+$/, "")
      .trim();
    return value || undefined;
  };

  const readRationals = (entry: ExifEntry | undefined): number[] => {
    if (!entry || entry.type !== 5 || entry.count === 0) {
      return [];
    }
    const valueOffset = absoluteOffset(readUInt32(entry.valueOffset));
    const values: number[] = [];
    for (let index = 0; index < entry.count; index += 1) {
      const offset = valueOffset + index * 8;
      if (offset + 8 > exif.length) {
        break;
      }
      const numerator = readUInt32(offset);
      const denominator = readUInt32(offset + 4);
      values.push(denominator === 0 ? 0 : numerator / denominator);
    }
    return values;
  };

  const ifd0 = readIfd(readUInt32(tiffStart + 4));
  const exifIfdOffset = ifd0.get(0x8769);
  const gpsIfdOffset = ifd0.get(0x8825);
  const exifIfd =
    exifIfdOffset?.type === 4
      ? readIfd(readUInt32(exifIfdOffset.valueOffset))
      : new Map();
  const gpsIfd =
    gpsIfdOffset?.type === 4
      ? readIfd(readUInt32(gpsIfdOffset.valueOffset))
      : new Map();

  const capturedAt = parseExifDate(readAscii(exifIfd.get(0x9003)));
  const cameraMake = readAscii(ifd0.get(0x010f));
  const cameraModel = readAscii(ifd0.get(0x0110));
  const lensModel = readAscii(exifIfd.get(0xa434));
  const location = parseGpsLocation({
    latitudeRef: readAscii(gpsIfd.get(0x0001)),
    latitude: readRationals(gpsIfd.get(0x0002)),
    longitudeRef: readAscii(gpsIfd.get(0x0003)),
    longitude: readRationals(gpsIfd.get(0x0004)),
  });

  return {
    ...(capturedAt ? { capturedAt } : {}),
    ...(cameraMake ? { cameraMake } : {}),
    ...(cameraModel ? { cameraModel } : {}),
    ...(lensModel ? { lensModel } : {}),
    ...(location ? { location } : {}),
  };
};

interface ExifEntry {
  type: number;
  count: number;
  valueOffset: number;
}

const parseExifDate = (value: string | undefined): string | undefined => {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    value ?? "",
  );
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
};

const parseGpsLocation = ({
  latitudeRef,
  latitude,
  longitudeRef,
  longitude,
}: {
  latitudeRef: string | undefined;
  latitude: number[];
  longitudeRef: string | undefined;
  longitude: number[];
}): ParsedExif["location"] => {
  if (latitude.length < 3 || longitude.length < 3) {
    return undefined;
  }
  const [latitudeDegrees, latitudeMinutes, latitudeSeconds] = latitude;
  const [longitudeDegrees, longitudeMinutes, longitudeSeconds] = longitude;
  if (
    latitudeDegrees === undefined ||
    latitudeMinutes === undefined ||
    latitudeSeconds === undefined ||
    longitudeDegrees === undefined ||
    longitudeMinutes === undefined ||
    longitudeSeconds === undefined
  ) {
    return undefined;
  }

  const latitudeSign = latitudeRef === "S" ? -1 : 1;
  const longitudeSign = longitudeRef === "W" ? -1 : 1;
  return {
    latitude:
      latitudeSign *
      (latitudeDegrees + latitudeMinutes / 60 + latitudeSeconds / 3600),
    longitude:
      longitudeSign *
      (longitudeDegrees + longitudeMinutes / 60 + longitudeSeconds / 3600),
  };
};

const resolveCapturedAt = (
  photo: PhotoProcessingItem,
  displayPhoto: DisplayPhotoResult,
): { value: string; source: CapturedAtSource } => {
  if (displayPhoto.capturedAt) {
    return {
      value: displayPhoto.capturedAt,
      source: "exif",
    };
  }
  if (photo.fileModifiedAt) {
    return {
      value: photo.fileModifiedAt,
      source: "fileModifiedTime",
    };
  }
  return {
    value: photo.uploadRequestedAt ?? new Date(0).toISOString(),
    source: "uploadTime",
  };
};

const removeUndefined = <T extends Record<string, unknown>>(input: T): T => {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
};

const logInfo = (message: string, detail: Record<string, unknown>): void => {
  console.log(
    JSON.stringify({
      level: "info",
      message,
      ...detail,
    }),
  );
};
