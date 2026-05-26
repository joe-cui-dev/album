import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type {
  GetUploadBatchStatusResponse,
  ProcessingState,
  UploadBatchPhotoStatus,
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok, unauthorized } from "../http.js";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const processingStates: ProcessingState[] = [
  "uploadRequested",
  "uploaded",
  "processing",
  "ready",
  "processingFailed",
  "exactDuplicate",
];

interface GetItemKey {
  pk: string;
  sk: string;
}

interface UploadBatchItem {
  uploadBatchId: string;
  userId: string;
  photoIds: string[];
}

interface PhotoStatusItem {
  photoId: string;
  fileName: string;
  processingState: ProcessingState;
  failureCode?: string;
  failureMessage?: string;
}

interface UploadBatchStatusDeps {
  getItem: (key: GetItemKey) => Promise<Record<string, unknown> | undefined>;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleGetUploadBatchStatus({
    user: getAuthenticatedUser(event),
    uploadBatchId: event.pathParameters?.uploadBatchId,
    deps: {
      getItem: async (key) => {
        const result = await dynamodb.send(
          new GetCommand({
            TableName: config.metadataTableName,
            Key: key,
          }),
        );
        return result.Item;
      },
    },
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

  const pk = `USER#${user.userId}`;
  const batch = asUploadBatchItem(
    await deps.getItem({ pk, sk: `UPLOAD_BATCH#${uploadBatchId}` }),
  );
  if (!batch || batch.userId !== user.userId) {
    return json(404, { message: "Upload batch not found" });
  }

  const photos = await Promise.all(
    batch.photoIds.map(async (photoId) =>
      asPhotoStatusItem(await deps.getItem({ pk, sk: `PHOTO#${photoId}` })),
    ),
  );
  const statuses = photos
    .filter((photo): photo is PhotoStatusItem => Boolean(photo))
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

const toPhotoStatus = (photo: PhotoStatusItem): UploadBatchPhotoStatus => {
  return {
    photoId: photo.photoId,
    fileName: photo.fileName,
    processingState: photo.processingState,
    exactDuplicate: photo.processingState === "exactDuplicate",
    ...(photo.failureCode ? { failureCode: photo.failureCode } : {}),
    ...(photo.failureMessage ? { failureMessage: photo.failureMessage } : {}),
  };
};

const asUploadBatchItem = (
  item: Record<string, unknown> | undefined,
): UploadBatchItem | undefined => {
  if (
    !item ||
    typeof item.uploadBatchId !== "string" ||
    typeof item.userId !== "string" ||
    !Array.isArray(item.photoIds) ||
    !item.photoIds.every((photoId) => typeof photoId === "string")
  ) {
    return undefined;
  }
  return item as unknown as UploadBatchItem;
};

const asPhotoStatusItem = (
  item: Record<string, unknown> | undefined,
): PhotoStatusItem | undefined => {
  if (
    !item ||
    typeof item.photoId !== "string" ||
    typeof item.fileName !== "string" ||
    !isProcessingState(item.processingState)
  ) {
    return undefined;
  }
  return {
    photoId: item.photoId,
    fileName: item.fileName,
    processingState: item.processingState,
    ...(typeof item.failureCode === "string"
      ? { failureCode: item.failureCode }
      : {}),
    ...(typeof item.failureMessage === "string"
      ? { failureMessage: item.failureMessage }
      : {}),
  };
};

const isProcessingState = (value: unknown): value is ProcessingState => {
  return processingStates.includes(value as ProcessingState);
};
