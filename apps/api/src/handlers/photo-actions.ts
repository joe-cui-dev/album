import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type {
  CreateTemporaryPhotoUrlResponse,
  GetPhotoDetailResponse,
  Photo,
} from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, json, ok } from "../http.js";
import { photoObjectStore } from "../store/configured-store.js";
import type { PersonalAlbum } from "../store/personal-album.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";

interface TemporaryUrlDeps {
  photoObjects: PhotoObjectStore;
}

export const getPhotoDetailHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleGetPhotoDetail({
    ...context,
    photoId: event.pathParameters?.photoId,
  }),
);

export const displayAccessUrlHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleCreateDisplayAccessUrl({
    ...context,
    photoId: event.pathParameters?.photoId,
    deps: {
      photoObjects: photoObjectStore,
    },
  }),
);

export const originalDownloadUrlHandler: APIGatewayProxyHandlerV2 = withAuth(
  (context, event) => handleCreateOriginalDownloadUrl({
    ...context,
    photoId: event.pathParameters?.photoId,
    deps: {
      photoObjects: photoObjectStore,
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

  return ok(toPhotoDetail(photo) satisfies GetPhotoDetailResponse, {
    headers: chronologyETagHeader(photo),
  });
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

  return ok(
    (await deps.photoObjects.presignDownload({
      objectKey: photo.displayObjectKey,
    })) satisfies CreateTemporaryPhotoUrlResponse,
  );
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

  return ok(
    (await deps.photoObjects.presignDownload({
      objectKey: photo.originalObjectKey,
      attachmentFileName: photo.fileName,
    })) satisfies CreateTemporaryPhotoUrlResponse,
  );
};

export const toPhotoDetail = (photo: Photo): GetPhotoDetailResponse => ({
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
  ...(photo.chronology ? { chronology: photo.chronology } : {}),
});

/** The ETag ties to chronology.active.revision, the precondition Adjust/Revert require via If-Match. */
export const chronologyETagHeader = (photo: Photo): Record<string, string> | undefined =>
  photo.chronology ? { etag: `"${photo.chronology.active.revision}"` } : undefined;
