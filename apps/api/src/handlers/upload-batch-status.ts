import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type {
  GetUploadBatchStatusResponse,
  ProcessingState,
  UploadBatchPhotoStatus,
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok, unauthorized } from "../http.js";
import { personalAlbumStore } from "../store/configured-store.js";
import type { PersonalAlbumStore } from "../store/personal-album.js";

const processingStates: ProcessingState[] = [
  "uploadRequested",
  "uploaded",
  "processing",
  "ready",
  "processingFailed",
  "exactDuplicate",
];

interface UploadBatchStatusDeps {
  store: PersonalAlbumStore;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleGetUploadBatchStatus({
    user: getAuthenticatedUser(event),
    uploadBatchId: event.pathParameters?.uploadBatchId,
    deps: { store: personalAlbumStore },
  });
};

export const handleGetUploadBatchStatus = async ({
  user,
  uploadBatchId,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  uploadBatchId: string | undefined;
  deps: UploadBatchStatusDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!user) {
    return unauthorized();
  }
  if (!uploadBatchId) {
    return badRequest("uploadBatchId is required");
  }

  const album = deps.store.personalAlbumOf(user.userId);
  const batch = await album.getUploadBatch(uploadBatchId);
  if (!batch) {
    return json(404, { message: "Upload batch not found" });
  }

  const photos = await Promise.all(
    batch.photoIds.map((photoId) => album.getPhoto(photoId)),
  );
  const statuses = photos
    .filter((photo): photo is import("@album/shared").Photo => Boolean(photo))
    .map(toPhotoStatus);
  const counts = emptyCounts();
  for (const photo of statuses) {
    counts[photo.processingState] += 1;
  }

  return ok({
    uploadBatchId: batch.uploadBatchId,
    counts,
    photos: statuses,
  } satisfies GetUploadBatchStatusResponse);
};

const emptyCounts = (): Record<ProcessingState, number> => {
  return Object.fromEntries(
    processingStates.map((state) => [state, 0]),
  ) as Record<ProcessingState, number>;
};

const toPhotoStatus = (photo: import("@album/shared").Photo): UploadBatchPhotoStatus => {
  return {
    photoId: photo.photoId,
    fileName: photo.fileName,
    processingState: photo.processingState,
    exactDuplicate: photo.processingState === "exactDuplicate",
    ...(photo.failureCode ? { failureCode: photo.failureCode } : {}),
    ...(photo.failureMessage ? { failureMessage: photo.failureMessage } : {}),
  };
};
