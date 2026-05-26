import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type {
  ProcessingState,
  RetryProcessingResponse,
  UploadBatchPhotoStatus,
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok, unauthorized } from "../http.js";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

interface RetryPhotoItem {
  photoId: string;
  fileName: string;
  processingState: ProcessingState;
  originalObjectKey: string;
  failureCode?: string;
  failureMessage?: string;
}

interface RetryProcessingDeps {
  getPhoto: (input: {
    userId: string;
    photoId: string;
  }) => Promise<RetryPhotoItem | undefined>;
  sendRetryMessage: (message: {
    userId: string;
    photoId: string;
    originalObjectKey: string;
  }) => Promise<void>;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleRetryProcessing({
    user: getAuthenticatedUser(event),
    photoId: event.pathParameters?.photoId,
    deps: {
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
        return asRetryPhotoItem(result.Item);
      },
      sendRetryMessage: async (message) => {
        if (!config.processingQueueUrl) {
          throw new Error("Missing PROCESSING_QUEUE_URL");
        }
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: config.processingQueueUrl,
            MessageBody: JSON.stringify({
              type: "retryPhotoProcessing",
              ...message,
            }),
          }),
        );
      },
    },
  });
};

export const handleRetryProcessing = async ({
  user,
  photoId,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  photoId: string | undefined;
  deps: RetryProcessingDeps;
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
  if (photo.processingState !== "processingFailed") {
    return json(409, { message: "Only failed photos can be retried" });
  }

  await deps.sendRetryMessage({
    userId: user.userId,
    photoId: photo.photoId,
    originalObjectKey: photo.originalObjectKey,
  });

  return ok(toPhotoStatus(photo) satisfies RetryProcessingResponse);
};

const toPhotoStatus = (photo: RetryPhotoItem): UploadBatchPhotoStatus => {
  return {
    photoId: photo.photoId,
    fileName: photo.fileName,
    processingState: photo.processingState,
    exactDuplicate: photo.processingState === "exactDuplicate",
    ...(photo.failureCode ? { failureCode: photo.failureCode } : {}),
    ...(photo.failureMessage ? { failureMessage: photo.failureMessage } : {}),
  };
};

const asRetryPhotoItem = (
  item: Record<string, unknown> | undefined,
): RetryPhotoItem | undefined => {
  if (
    !item ||
    typeof item.photoId !== "string" ||
    typeof item.fileName !== "string" ||
    typeof item.originalObjectKey !== "string" ||
    !isProcessingState(item.processingState)
  ) {
    return undefined;
  }
  return {
    photoId: item.photoId,
    fileName: item.fileName,
    processingState: item.processingState,
    originalObjectKey: item.originalObjectKey,
    ...(typeof item.failureCode === "string"
      ? { failureCode: item.failureCode }
      : {}),
    ...(typeof item.failureMessage === "string"
      ? { failureMessage: item.failureMessage }
      : {}),
  };
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
