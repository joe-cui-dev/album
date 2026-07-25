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

  const existing = await album.getProcessingIssue(photo.photoId);
  const now = deps.now();
  if (
    existing?.retryAttemptId &&
    (existing.status === "retrying" ||
      (existing.retryReservationExpiresAt !== undefined && existing.retryReservationExpiresAt >= now.toISOString()))
  ) {
    return json(202, { accepted: true, retryAttemptId: existing.retryAttemptId } satisfies RetryProcessingResponse);
  }

  const retryAttemptId = deps.newRetryAttemptId();
  const reserved = await album.reserveProcessingIssueRetry({
    photoId: photo.photoId,
    retryAttemptId,
    reservedAt: now.toISOString(),
    reservationExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  });
  if (reserved.retryAttemptId !== retryAttemptId) {
    return json(202, { accepted: true, retryAttemptId: reserved.retryAttemptId } satisfies RetryProcessingResponse);
  }
  try {
    await deps.sendRetryMessage({
      userId: user.userId,
      photoId: photo.photoId,
      originalObjectKey: photo.originalObjectKey,
      retryAttemptId,
    });
  } catch (error) {
    await album.releaseProcessingIssueRetry({ photoId: photo.photoId, retryAttemptId });
    throw error;
  }
  let current: { retryAttemptId: string };
  try {
    current = await album.beginProcessingIssueRetry({
      photoId: photo.photoId,
      retryAttemptId,
      attemptedAt: now.toISOString(),
    });
  } catch (error) {
    // SQS already accepted the message. A worker may have resolved the Issue in
    // the narrow send-before-mark window; this is still an accepted retry.
    const latest = await album.getProcessingIssue(photo.photoId);
    if (latest) throw error;
    current = { retryAttemptId };
  }
  return json(
    202,
    { accepted: true, retryAttemptId: current.retryAttemptId } satisfies RetryProcessingResponse,
  );
};
