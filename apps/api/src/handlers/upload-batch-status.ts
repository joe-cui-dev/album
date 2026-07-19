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
  store?: PersonalAlbumStore;
  getItem?: (key: { pk: string; sk: string }) => Promise<Record<string, unknown> | undefined>;
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

  const album = deps.store?.personalAlbumOf(user.userId);
  const batch = album
    ? await album.getUploadBatch(uploadBatchId)
    : asUploadBatch(await deps.getItem?.({ pk: `USER#${user.userId}`, sk: `UPLOAD_BATCH#${uploadBatchId}` }));
  if (!batch) {
    return json(404, { message: "Upload batch not found" });
  }

  const photos = await Promise.all(
    batch.photoIds.map(async (photoId) =>
      album
        ? album.getPhoto(photoId)
        : asPhotoStatus(await deps.getItem?.({ pk: `USER#${user.userId}`, sk: `PHOTO#${photoId}` })),
    ),
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

const asUploadBatch = (item: Record<string, unknown> | undefined) =>
  item &&
  typeof item.uploadBatchId === "string" &&
  typeof item.userId === "string" &&
  Array.isArray(item.photoIds) &&
  item.photoIds.every((photoId) => typeof photoId === "string")
    ? (item as unknown as { uploadBatchId: string; userId: string; photoIds: string[] })
    : undefined;

const asPhotoStatus = (item: Record<string, unknown> | undefined) =>
  item &&
  typeof item.photoId === "string" &&
  typeof item.fileName === "string" &&
  typeof item.originalObjectKey === "string" &&
  processingStates.includes(item.processingState as ProcessingState)
    ? ({
        ...item,
        uploadBatchId: typeof item.uploadBatchId === "string" ? item.uploadBatchId : "",
        userId: typeof item.userId === "string" ? item.userId : "",
        format: "jpeg",
        fileSizeBytes: 0,
        archived: false,
      } as import("@album/shared").Photo)
    : undefined;
