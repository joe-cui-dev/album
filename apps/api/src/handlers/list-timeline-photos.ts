import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ListTimelinePhotosResponse,
  ProcessingState,
  TimelinePhoto,
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, ok, unauthorized } from "../http.js";

const temporaryUrlExpiresInSeconds = 300;
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

interface TimelineItem {
  photoId: string;
  capturedAt: string;
}

interface TimelinePhotoItem {
  photoId: string;
  fileName: string;
  capturedAt: string;
  processingState: ProcessingState;
  archived: boolean;
  displayObjectKey?: string;
  displayDimensions?: {
    width: number;
    height: number;
  };
  timelineThumbnailObjectKey?: string;
  timelineThumbnailDimensions?: {
    width: number;
    height: number;
  };
}

interface TimelineQuery {
  year?: string;
  month?: string;
  processingState?: string;
  archived?: string;
}

interface ListTimelineDeps {
  queryTimeline: (input: {
    userId: string;
    fromCapturedAt?: string;
    toCapturedAt?: string;
  }) => Promise<TimelineItem[]>;
  getPhoto: (input: {
    userId: string;
    photoId: string;
  }) => Promise<TimelinePhotoItem | undefined>;
  createTimelineThumbnailUrl: (input: { objectKey: string }) => Promise<string>;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleListTimelinePhotos({
    user: getAuthenticatedUser(event),
    query: event.queryStringParameters ?? {},
    deps: {
      queryTimeline: async ({ userId, fromCapturedAt, toCapturedAt }) => {
        const expressionValues: Record<string, string> = {
          ":pk": `USER#${userId}`,
        };
        let keyConditionExpression = "pk = :pk AND begins_with(sk, :timeline)";

        if (fromCapturedAt && toCapturedAt) {
          keyConditionExpression = "pk = :pk AND sk BETWEEN :fromSk AND :toSk";
          expressionValues[":fromSk"] = `TIMELINE#${fromCapturedAt}`;
          expressionValues[":toSk"] = `TIMELINE#${toCapturedAt}`;
        } else {
          expressionValues[":timeline"] = "TIMELINE#";
        }

        const result = await dynamodb.send(
          new QueryCommand({
            TableName: config.metadataTableName,
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeValues: expressionValues,
          }),
        );
        return (
          result.Items?.map(asTimelineItem).filter(
            (item): item is TimelineItem => Boolean(item),
          ) ?? []
        );
      },
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
        return asTimelinePhotoItem(result.Item);
      },
      createTimelineThumbnailUrl,
    },
  });
};

export const handleListTimelinePhotos = async ({
  user,
  query,
  deps,
}: {
  user: AuthenticatedUser | undefined;
  query: TimelineQuery;
  deps: ListTimelineDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!user) {
    return unauthorized();
  }

  const capturedAtRange = rangeFromQuery(query);
  if (!capturedAtRange.valid) {
    return badRequest(capturedAtRange.message);
  }
  if (
    query.processingState !== undefined &&
    !isProcessingState(query.processingState)
  ) {
    return badRequest("processingState is invalid");
  }
  if (query.archived !== undefined && !["true", "false"].includes(query.archived)) {
    return badRequest("archived must be true or false");
  }

  const timelineItems = await deps.queryTimeline({
    userId: user.userId,
    ...capturedAtRange.range,
  });
  const visiblePhotos = (
    await Promise.all(
      timelineItems.map((item) =>
        deps.getPhoto({ userId: user.userId, photoId: item.photoId }),
      ),
    )
  )
    .filter((photo): photo is TimelinePhotoItem => Boolean(photo))
    .filter((photo) =>
      query.processingState
        ? photo.processingState === query.processingState
        : photo.processingState === "ready",
    )
    .filter((photo) =>
      query.archived === "true" ? photo.archived : !photo.archived,
    )
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const photos = await Promise.all(
    visiblePhotos.map((photo) => toTimelinePhoto(photo, deps)),
  );

  return ok({ photos } satisfies ListTimelinePhotosResponse);
};

const rangeFromQuery = (
  query: TimelineQuery,
):
  | {
      valid: true;
      range: { fromCapturedAt?: string; toCapturedAt?: string };
    }
  | { valid: false; message: string } => {
  if (query.month && !query.year) {
    return { valid: false, message: "year is required when month is provided" };
  }
  if (!query.year) {
    return { valid: true, range: {} };
  }
  const year = Number(query.year);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    return { valid: false, message: "year is invalid" };
  }
  const month =
    query.month === undefined || query.month === ""
      ? undefined
      : Number(query.month);
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return { valid: false, message: "month is invalid" };
  }

  const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
  const to = new Date(Date.UTC(year, month ? month : 12, 1));
  return {
    valid: true,
    range: {
      fromCapturedAt: from.toISOString(),
      toCapturedAt: to.toISOString(),
    },
  };
};

const toTimelinePhoto = async (
  photo: TimelinePhotoItem,
  deps: Pick<ListTimelineDeps, "createTimelineThumbnailUrl">,
): Promise<TimelinePhoto> => {
  const timelineThumbnailUrl =
    photo.processingState === "ready" && photo.timelineThumbnailObjectKey
      ? await deps.createTimelineThumbnailUrl({
          objectKey: photo.timelineThumbnailObjectKey,
        })
      : undefined;

  return {
    photoId: photo.photoId,
    fileName: photo.fileName,
    capturedAt: photo.capturedAt,
    processingState: photo.processingState,
    archived: photo.archived,
    ...(photo.displayObjectKey ? { displayObjectKey: photo.displayObjectKey } : {}),
    ...(photo.displayDimensions
      ? { displayDimensions: photo.displayDimensions }
      : {}),
    ...(timelineThumbnailUrl ? { timelineThumbnailUrl } : {}),
    ...(photo.timelineThumbnailDimensions
      ? { timelineThumbnailDimensions: photo.timelineThumbnailDimensions }
      : {}),
  };
};

const createTimelineThumbnailUrl = async ({ objectKey }: { objectKey: string }) => {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: config.photosBucketName,
      Key: objectKey,
    }),
    {
      expiresIn: temporaryUrlExpiresInSeconds,
    },
  );
};

const asTimelineItem = (
  item: Record<string, unknown> | undefined,
): TimelineItem | undefined => {
  if (
    !item ||
    typeof item.photoId !== "string" ||
    typeof item.capturedAt !== "string"
  ) {
    return undefined;
  }
  return {
    photoId: item.photoId,
    capturedAt: item.capturedAt,
  };
};

const asTimelinePhotoItem = (
  item: Record<string, unknown> | undefined,
): TimelinePhotoItem | undefined => {
  if (
    !item ||
    typeof item.photoId !== "string" ||
    typeof item.fileName !== "string" ||
    typeof item.capturedAt !== "string" ||
    !isProcessingState(item.processingState) ||
    typeof item.archived !== "boolean"
  ) {
    return undefined;
  }
  return item as unknown as TimelinePhotoItem;
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
