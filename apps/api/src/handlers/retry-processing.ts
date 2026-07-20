import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import type { RetryProcessingResponse } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { config } from "../config.js";
import { badRequest, json } from "../http.js";
import type { PersonalAlbum } from "../store/personal-album.js";

const sqs = new SQSClient({});

interface RetryProcessingDeps {
  sendRetryMessage: (message: {
    userId: string;
    photoId: string;
    originalObjectKey: string;
    retryAttemptId: string;
  }) => Promise<void>;
  newRetryAttemptId: () => string;
  now: () => Date;
}

export const handler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleRetryProcessing({
    ...context,
    photoId: event.pathParameters?.photoId,
    deps: {
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
      newRetryAttemptId: randomUUID,
      now: () => new Date(),
    },
  }),
);

export const handleRetryProcessing = async ({
  user,
  album,
  photoId,
  deps,
}: AuthedContext & {
  photoId: string | undefined;
  deps: RetryProcessingDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "processingFailed") {
    return json(409, { message: "Only failed photos can be retried" });
  }

  const retryAttemptId = deps.newRetryAttemptId();
  await deps.sendRetryMessage({
    userId: user.userId,
    photoId: photo.photoId,
    originalObjectKey: photo.originalObjectKey,
    retryAttemptId,
  });
  const current = await album.beginProcessingIssueRetryV2({
    photoId: photo.photoId,
    retryAttemptId,
    attemptedAt: deps.now().toISOString(),
  });
  return json(
    202,
    { accepted: true, retryAttemptId: current.retryAttemptId } satisfies RetryProcessingResponse,
  );
};
