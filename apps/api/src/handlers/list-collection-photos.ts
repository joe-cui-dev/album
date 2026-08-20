import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getCapturedAtComponents, type AnchorPeriod, type ListCollectionPhotosResponse, type TimelinePhoto } from "@album/shared";
import { conservativeExpiresAt } from "../access-expiry.js";
import { decodeTimelineCursor, encodeTimelineCursor } from "../cursor.js";
import { buildTimelineThumbnailSources } from "../thumbnail-sources.js";
import { parseStartAt, timelinePeriodUpperBoundSortKey, type PhotoCollection } from "../store/projection-keys.js";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, conflict, ok } from "../http.js";
import { photoObjectStore } from "../store/configured-store.js";
import type { TimelineProjection } from "../store/personal-album.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";

const DEFAULT_LIMIT = 80;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

interface CollectionQuery {
  limit?: string;
  cursor?: string;
  startAt?: string;
}

interface ListCollectionDeps {
  photoObjects: PhotoObjectStore;
}

export const timelinePhotosHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleListCollectionPhotos({
    ...context,
    collection: "active",
    query: event.queryStringParameters ?? {},
    deps: { photoObjects: photoObjectStore },
  }),
);

export const trashPhotosHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleListCollectionPhotos({
    ...context,
    collection: "trashed",
    query: event.queryStringParameters ?? {},
    deps: { photoObjects: photoObjectStore },
  }),
);

export const favouritePhotosHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleListCollectionPhotos({
    ...context,
    collection: "favourite",
    query: event.queryStringParameters ?? {},
    deps: { photoObjects: photoObjectStore },
  }),
);

export const handleListCollectionPhotos = async ({
  album,
  collection,
  query,
  deps,
}: AuthedContext & {
  collection: PhotoCollection;
  query: CollectionQuery;
  deps: ListCollectionDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (query.cursor !== undefined && query.startAt !== undefined) {
    return badRequest("cursor and startAt are mutually exclusive");
  }

  const limit = parseLimit(query.limit);
  if (limit === undefined) {
    return badRequest(`limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }

  let after: { sortKey: string } | undefined;
  if (query.cursor !== undefined) {
    const cursor = decodeTimelineCursor(query.cursor, collection);
    if (!cursor) {
      return badRequest("cursor is invalid");
    }
    after = { sortKey: cursor.after };
  }

  let atOrBefore: { sortKey: string } | undefined;
  if (query.startAt !== undefined) {
    const period = parseStartAt(query.startAt);
    if (!period) {
      return badRequest("startAt is invalid");
    }
    const periodKey = period.month !== undefined ? String(period.month).padStart(2, "0") : "unknown";
    const counts = await album.getDateIndex(collection, period.year);
    if (!counts[periodKey]) {
      return conflict("empty_period", "This period is now empty. Refresh navigation and try again.");
    }
    atOrBefore = { sortKey: timelinePeriodUpperBoundSortKey(collection, period) };
  }

  const page = await album.queryTimelinePage({
    collection,
    limit,
    ...(after ? { after } : {}),
    ...(atOrBefore ? { atOrBefore } : {}),
  });

  const resolved = await Promise.all(
    page.projections.map((projection) => toTimelinePhoto(projection, deps)),
  );
  const photos = resolved.map(({ photo }) => photo);
  const firstProjection = page.projections[0];

  return ok(
    {
      photos,
      ...(page.lastSortKey
        ? { nextCursor: encodeTimelineCursor({ collection, after: page.lastSortKey }) }
        : {}),
      ...(firstProjection ? { anchorPeriod: anchorPeriodOf(firstProjection) } : {}),
      ...(resolved.length
        ? { expiresAt: conservativeExpiresAt(resolved.map(({ expiresInSeconds }) => expiresInSeconds)) }
        : {}),
    } satisfies ListCollectionPhotosResponse,
    { headers: NO_STORE_HEADERS },
  );
};

const parseLimit = (raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= MIN_LIMIT && value <= MAX_LIMIT ? value : undefined;
};

const anchorPeriodOf = (projection: TimelineProjection): AnchorPeriod => {
  const { year, month } = getCapturedAtComponents(projection.capturedAt);
  return month !== undefined ? { year, month } : { year };
};

const toTimelinePhoto = async (
  projection: TimelineProjection,
  deps: ListCollectionDeps,
): Promise<{ photo: TimelinePhoto; expiresInSeconds: number }> => {
  const [small, large] = await Promise.all([
    deps.photoObjects.presignDownload({ objectKey: projection.timelineThumbnails.small.objectKey }),
    deps.photoObjects.presignDownload({ objectKey: projection.timelineThumbnails.large.objectKey }),
  ]);
  return {
    photo: {
      photoId: projection.photoId,
      fileName: projection.fileName,
      capturedAt: projection.capturedAt,
      addedAt: projection.addedAt,
      displayDimensions: projection.displayDimensions,
      timelineThumbnailSources: buildTimelineThumbnailSources({
        small: { url: small.url, dimensions: projection.timelineThumbnails.small.dimensions },
        large: { url: large.url, dimensions: projection.timelineThumbnails.large.dimensions },
      }),
      favourite: projection.favourite,
      ...(projection.deletedAt ? { deletedAt: projection.deletedAt } : {}),
    },
    expiresInSeconds: Math.min(small.expiresInSeconds, large.expiresInSeconds),
  };
};
