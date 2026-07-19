import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ArchivePhotoResponse,
  CreateTemporaryPhotoUrlResponse,
  GetPhotoDetailResponse,
  Photo,
} from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { config } from "../config.js";
import { badRequest, json, ok } from "../http.js";
import type { PersonalAlbum } from "../store/personal-album.js";

const temporaryUrlExpiresInSeconds = 300;
const s3 = new S3Client({});

interface TemporaryUrlDeps {
  createTemporaryUrl: (input: {
    objectKey: string;
    downloadFileName?: string;
  }) => Promise<string>;
}

export const getPhotoDetailHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleGetPhotoDetail({
    ...context,
    photoId: event.pathParameters?.photoId,
  }),
);

export const archivePhotoHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleArchivePhoto({
    ...context,
    photoId: event.pathParameters?.photoId,
  }),
);

export const displayAccessUrlHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleCreateDisplayAccessUrl({
    ...context,
    photoId: event.pathParameters?.photoId,
    deps: {
      createTemporaryUrl,
    },
  }),
);

export const originalDownloadUrlHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleCreateOriginalDownloadUrl({
    ...context,
    photoId: event.pathParameters?.photoId,
    deps: {
      createTemporaryUrl,
    },
  }),
);

export const handleGetPhotoDetail = async ({
  album,
  photoId,
}: AuthedContext & {
  photoId: string | undefined;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }

  return ok(toPhotoDetail(photo) satisfies GetPhotoDetailResponse);
};

export const handleArchivePhoto = async ({
  album,
  photoId,
}: AuthedContext & {
  photoId: string | undefined;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }

  await album.archivePhoto(photoId);

  return ok({ photoId, archived: true } satisfies ArchivePhotoResponse);
};

export const handleCreateDisplayAccessUrl = async ({
  user,
  album,
  photoId,
  deps,
}: AuthedContext & {
  photoId: string | undefined;
  deps: TemporaryUrlDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await album.getPhoto(photoId);
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
  album,
  photoId,
  deps,
}: AuthedContext & {
  photoId: string | undefined;
  deps: TemporaryUrlDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await album.getPhoto(photoId);
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

const toPhotoDetail = (photo: Photo): GetPhotoDetailResponse => ({
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
