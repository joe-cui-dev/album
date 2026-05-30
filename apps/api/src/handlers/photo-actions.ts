import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ArchivePhotoResponse,
  CapturedAtSource,
  CreateTemporaryPhotoUrlResponse,
  GetPhotoDetailResponse,
  PhotoFormat,
  PhotoMetadata,
  ProcessingState,
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok, unauthorized } from "../http.js";

const temporaryUrlExpiresInSeconds = 300;
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

interface PhotoActionItem {
  photoId: string;
  userId: string;
  fileName: string;
  format: PhotoFormat;
  fileSizeBytes: number;
  originalObjectKey: string;
  displayObjectKey?: string;
  capturedAt?: string;
  capturedAtSource?: CapturedAtSource;
  processingState: ProcessingState;
  archived: boolean;
  metadata?: PhotoMetadata;
  displayDimensions?: {
    width: number;
    height: number;
  };
}

interface GetPhotoDeps {
  getPhoto: (input: {
    userId: string;
    photoId: string;
  }) => Promise<PhotoActionItem | undefined>;
}

interface ArchivePhotoDeps extends GetPhotoDeps {
  archivePhoto: (input: { userId: string; photoId: string }) => Promise<void>;
}

interface TemporaryUrlDeps extends GetPhotoDeps {
  createTemporaryUrl: (input: {
    objectKey: string;
    downloadFileName?: string;
  }) => Promise<string>;
}

const getPhoto = async (userId: string, photoId: string) => {
  const result = await dynamodb.send(
    new GetCommand({
      TableName: config.metadataTableName,
      Key: {
        pk: `USER#${userId}`,
        sk: `PHOTO#${photoId}`,
      },
    }),
  );
  return asPhotoActionItem(result.Item);
};

export const getPhotoDetailHandler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleGetPhotoDetail({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: { getPhoto: ({ userId, photoId }) => getPhoto(userId, photoId) },
  });
};

export const archivePhotoHandler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleArchivePhoto({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: {
      getPhoto: ({ userId, photoId }) => getPhoto(userId, photoId),
      archivePhoto: async ({ userId, photoId }) => {
        await dynamodb.send(
          new UpdateCommand({
            TableName: config.metadataTableName,
            Key: {
              pk: `USER#${userId}`,
              sk: `PHOTO#${photoId}`,
            },
            UpdateExpression: "SET archived = :archived",
            ExpressionAttributeValues: {
              ":archived": true,
            },
          }),
        );
      },
    },
  });
};

export const displayAccessUrlHandler: APIGatewayProxyHandlerV2 = async (
  event,
) => {
  return handleCreateDisplayAccessUrl({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: {
      getPhoto: ({ userId, photoId }) => getPhoto(userId, photoId),
      createTemporaryUrl,
    },
  });
};

export const originalDownloadUrlHandler: APIGatewayProxyHandlerV2 = async (
  event,
) => {
  return handleCreateOriginalDownloadUrl({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: {
      getPhoto: ({ userId, photoId }) => getPhoto(userId, photoId),
      createTemporaryUrl,
    },
  });
};

export const handleGetPhotoDetail = async ({
  user,
  photoId,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  photoId: string | undefined;
  deps: GetPhotoDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!user) {
    return unauthorized();
  }
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await deps.getPhoto({ userId: user.userId, photoId });
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }

  return ok(toPhotoDetail(photo) satisfies GetPhotoDetailResponse);
};

export const handleArchivePhoto = async ({
  user,
  photoId,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  photoId: string | undefined;
  deps: ArchivePhotoDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!user) {
    return unauthorized();
  }
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await deps.getPhoto({ userId: user.userId, photoId });
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }

  await deps.archivePhoto({ userId: user.userId, photoId });

  return ok({ photoId, archived: true } satisfies ArchivePhotoResponse);
};

export const handleCreateDisplayAccessUrl = async ({
  user,
  photoId,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  photoId: string | undefined;
  deps: TemporaryUrlDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!user) {
    return unauthorized();
  }
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await deps.getPhoto({ userId: user.userId, photoId });
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "ready" || !photo.displayObjectKey) {
    return json(409, { message: "Photo display is not ready" });
  }

  return ok({
    url: await deps.createTemporaryUrl({ objectKey: photo.displayObjectKey }),
    expiresInSeconds: temporaryUrlExpiresInSeconds,
  } satisfies CreateTemporaryPhotoUrlResponse);
};

export const handleCreateOriginalDownloadUrl = async ({
  user,
  photoId,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  photoId: string | undefined;
  deps: TemporaryUrlDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!user) {
    return unauthorized();
  }
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await deps.getPhoto({ userId: user.userId, photoId });
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }

  return ok({
    url: await deps.createTemporaryUrl({
      objectKey: photo.originalObjectKey,
      downloadFileName: photo.fileName,
    }),
    expiresInSeconds: temporaryUrlExpiresInSeconds,
  } satisfies CreateTemporaryPhotoUrlResponse);
};

const createTemporaryUrl = async ({
  objectKey,
  downloadFileName,
}: {
  objectKey: string;
  downloadFileName?: string;
}) => {
  const command = new GetObjectCommand({
    Bucket: config.photosBucketName,
    Key: objectKey,
    ...(downloadFileName
      ? {
          ResponseContentDisposition: `attachment; filename="${contentDispositionFileName(downloadFileName)}"`,
        }
      : {}),
  });
  return getSignedUrl(s3, command, {
    expiresIn: temporaryUrlExpiresInSeconds,
  });
};

const contentDispositionFileName = (fileName: string): string => {
  return fileName.replace(/["\\\r\n]/g, "_");
};

const toPhotoDetail = (photo: PhotoActionItem): GetPhotoDetailResponse => ({
  photoId: photo.photoId,
  fileName: photo.fileName,
  format: photo.format,
  fileSizeBytes: photo.fileSizeBytes,
  ...(photo.capturedAt ? { capturedAt: photo.capturedAt } : {}),
  ...(photo.capturedAtSource
    ? { capturedAtSource: photo.capturedAtSource }
    : {}),
  processingState: photo.processingState,
  archived: photo.archived,
  ...(photo.metadata ? { metadata: photo.metadata } : {}),
  ...(photo.displayDimensions
    ? { displayDimensions: photo.displayDimensions }
    : {}),
});

const asPhotoActionItem = (
  item: Record<string, unknown> | undefined,
): PhotoActionItem | undefined => {
  if (
    !item ||
    typeof item.photoId !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.fileName !== "string" ||
    !isPhotoFormat(item.format) ||
    typeof item.fileSizeBytes !== "number" ||
    typeof item.originalObjectKey !== "string" ||
    !isProcessingState(item.processingState) ||
    typeof item.archived !== "boolean"
  ) {
    return undefined;
  }
  return item as unknown as PhotoActionItem;
};

const isPhotoFormat = (value: unknown): value is PhotoFormat => {
  return ["jpeg", "png", "heic"].includes(value as PhotoFormat);
};

const isProcessingState = (value: unknown): value is ProcessingState => {
  return [
    "uploadRequested",
    "uploaded",
    "processing",
    "ready",
    "processingFailed",
    "exactDuplicate",
  ].includes(value as ProcessingState);
};
