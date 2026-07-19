import type { SQSEvent, SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CapturedAtSource, Photo, PhotoMetadata } from "@album/shared";
import {
  displayPhotoLongestEdgePixels,
  buildDisplayObjectKey,
  buildTimelineThumbnailObjectKey,
  matchesOriginalObjectMetadata,
  parseOriginalObjectKey,
  timelineThumbnailLongestEdgePixels,
} from "@album/shared";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { config } from "../config.js";
import { personalAlbumStore } from "../store/configured-store.js";
import type { PersonalAlbumStore } from "../store/personal-album.js";

const s3 = new S3Client({});

interface ProcessRecord {
  messageId: string;
  body: string;
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
  store: PersonalAlbumStore;
  readObjectBytes: (objectKey: string) => Promise<Uint8Array>;
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
      store: personalAlbumStore,
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
      const album = processAlbum(deps, keyParts.userId);

      const metadata = await deps.getObjectMetadata(objectKey);
      if (!matchesOriginalObjectMetadata(metadata, keyParts)) {
        const photo = await album.getPhoto(keyParts.photoId);
        if (photo) {
          await album.markProcessingFailed({
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

      const photo = await album.getPhoto(keyParts.photoId);
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

      await album.markProcessingStarted(keyParts.photoId);
      const originalBytes = await deps.readObjectBytes(objectKey);
      const sha256 = createHash("sha256").update(originalBytes).digest("hex");
      const duplicate = await album.findReadyPhotoBySha256({
        sha256,
        excludePhotoId: keyParts.photoId,
      });
      if (duplicate) {
        await album.markExactDuplicate({
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
        await album.markProcessingFailed({
          photoId: keyParts.photoId,
          failureCode: "unsupportedImage",
          failureMessage: "We couldn't process this photo.",
        });
        continue;
      }

      const displayObjectKey = buildDisplayObjectKey(keyParts);
      const timelineThumbnailObjectKey = buildTimelineThumbnailObjectKey(keyParts);
      const capturedAt = resolveCapturedAt(photo, displayPhoto);
      await deps.writeDisplayPhoto({
        objectKey: displayObjectKey,
        body: displayPhoto.body,
      });
      await deps.writeTimelineThumbnail({
        objectKey: timelineThumbnailObjectKey,
        body: timelineThumbnail.body,
      });
      await album.markReady({
        photoId: keyParts.photoId,
        fileName: photo.fileName ?? keyParts.photoId,
        sha256,
        displayObjectKey,
        displayDimensions: displayPhoto.dimensions,
        timelineThumbnailObjectKey,
        timelineThumbnailDimensions: timelineThumbnail.dimensions,
        capturedAt: capturedAt.value,
        capturedAtSource: capturedAt.source,
        metadata: displayPhoto.metadata,
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
  photo: Pick<Photo, "fileModifiedAt" | "uploadRequestedAt">,
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

const processAlbum = (deps: ProcessPhotoDeps, userId: string) =>
  deps.store.personalAlbumOf(userId);

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
