import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ListTimelinePhotosResponse,
  Photo,
  ProcessingState,
  TimelinePhoto,
} from "@album/shared";
import type { AuthenticatedUser } from "../auth.js";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, ok, unauthorized } from "../http.js";
import { personalAlbumStore } from "../store/configured-store.js";
import type { PersonalAlbumStore } from "../store/personal-album.js";

const temporaryUrlExpiresInSeconds = 300;
const s3 = new S3Client({});

interface TimelineQuery {
  year?: string;
  month?: string;
  processingState?: string;
  archived?: string;
}

interface ListTimelineDeps {
  store: PersonalAlbumStore;
  createTimelineThumbnailUrl: (input: { objectKey: string }) => Promise<string>;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return handleListTimelinePhotos({
    user: getAuthenticatedUser(event),
    query: event.queryStringParameters ?? {},
    deps: {
      store: personalAlbumStore,
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

  const visiblePhotos = await deps.store.personalAlbumOf(user.userId).listTimelinePhotos({
    ...capturedAtRange.range,
    processingState: query.processingState ?? "ready",
    archived: query.archived === "true",
  });
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
  photo: Photo,
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
    capturedAt: photo.capturedAt ?? "",
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
