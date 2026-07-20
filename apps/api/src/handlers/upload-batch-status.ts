import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type {
  GetUploadBatchStatusResponse,
  ProcessingState,
  UploadBatchPhotoStatus,
} from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { config } from "../config.js";
import { badRequest, json, ok } from "../http.js";
import type { PersonalAlbum } from "../store/personal-album.js";

const processingStates: ProcessingState[] = [
  "uploadRequested",
  "processing",
  "ready",
  "processingFailed",
  "exactDuplicate",
];

export const handler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleGetUploadBatchStatus({
    ...context,
    uploadBatchId: event.pathParameters?.uploadBatchId,
  }),
);

export const handleGetUploadBatchStatus = async ({
  album,
  uploadBatchId,
}: AuthedContext & {
  uploadBatchId: string | undefined;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!uploadBatchId) {
    return badRequest("uploadBatchId is required");
  }

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
