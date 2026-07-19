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
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok, unauthorized } from "../http.js";
import { personalAlbumStore } from "../store/configured-store.js";
import type { PersonalAlbumStore } from "../store/personal-album.js";

const temporaryUrlExpiresInSeconds = 300;
const s3 = new S3Client({});

interface PhotoActionItem {
  photoId: string;
  userId: string;
  fileName: string;
  format: import("@album/shared").PhotoFormat;
  fileSizeBytes: number;
  originalObjectKey: string;
  displayObjectKey?: string;
  capturedAt?: string;
  capturedAtSource?: import("@album/shared").CapturedAtSource;
  processingState: import("@album/shared").ProcessingState;
  archived: boolean;
  metadata?: import("@album/shared").PhotoMetadata;
  displayDimensions?: { width: number; height: number };
}

interface GetPhotoDeps {
  store?: PersonalAlbumStore;
  getPhoto?: (input: { userId: string; photoId: string }) => Promise<PhotoActionItem | undefined>;
}

interface ArchivePhotoDeps extends GetPhotoDeps {
  archivePhoto?: (input: { userId: string; photoId: string }) => Promise<void>;
}

interface TemporaryUrlDeps extends GetPhotoDeps {
  createTemporaryUrl: (input: {
    objectKey: string;
    downloadFileName?: string;
  }) => Promise<string>;
}

export const getPhotoDetailHandler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleGetPhotoDetail({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: { store: personalAlbumStore },
  });
};

export const archivePhotoHandler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleArchivePhoto({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: { store: personalAlbumStore },
  });
};

export const displayAccessUrlHandler: APIGatewayProxyHandlerV2 = async (
  event,
) => {
  return handleCreateDisplayAccessUrl({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: {
      store: personalAlbumStore,
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
      store: personalAlbumStore,
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

  const photo = await getPhoto(deps, user.userId, photoId);
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

  const photo = await getPhoto(deps, user.userId, photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }

  if (deps.store) {
    await deps.store.personalAlbumOf(user.userId).archivePhoto(photoId);
  } else {
    await deps.archivePhoto?.({ userId: user.userId, photoId });
  }

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

  const photo = await getPhoto(deps, user.userId, photoId);
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

  const photo = await getPhoto(deps, user.userId, photoId);
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

const getPhoto = async (
  deps: GetPhotoDeps,
  userId: string,
  photoId: string,
) => {
  if (deps.store) {
    return deps.store.personalAlbumOf(userId).getPhoto(photoId);
  }
  return deps.getPhoto?.({ userId, photoId });
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
