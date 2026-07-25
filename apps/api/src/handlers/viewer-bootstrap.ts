import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { Photo, PhotoCollection, ViewerBootstrapResponse } from "@album/shared";
import { conservativeExpiresAt } from "../access-expiry.js";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, conflict, json, ok } from "../http.js";
import { photoObjectStore } from "../store/configured-store.js";
import type { PersonalAlbum, TimelineProjection } from "../store/personal-album.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

interface ViewerBootstrapDeps {
  photoObjects: PhotoObjectStore;
}

export const handler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleViewerBootstrap({
    ...context,
    photoId: event.pathParameters?.photoId,
    requestedCollection: parseCollection(event.queryStringParameters?.collection),
    deps: { photoObjects: photoObjectStore },
  }),
);

export const handleViewerBootstrap = async ({
  album,
  photoId,
  requestedCollection,
  deps,
}: AuthedContext & {
  photoId: string | undefined;
  requestedCollection: PhotoCollection | "invalid" | undefined;
  deps: ViewerBootstrapDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }
  if (requestedCollection === "invalid") {
    return badRequest("collection must be active or archived");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "ready" || !photo.chronology || !photo.uploadRequestedAt) {
    return json(409, { message: "Photo is not Ready" });
  }

  const currentCollection = collectionOf(photo);
  if (requestedCollection && requestedCollection !== currentCollection) {
    return conflict("photo_collection_changed", "The Photo's collection changed", {
      currentCollection,
    });
  }

  const resolution = await resolveWithOneRetry({ album, photoId, photo });
  if (resolution.outcome === "concurrent_movement") {
    return conflict("concurrent_projection_movement", "The Photo changed concurrently; refresh and try again");
  }
  const { photo: resolvedPhoto, collection, newer, older } = resolution;

  const displayAccess = await deps.photoObjects.presignDownload({ objectKey: resolvedPhoto.displayObjectKey! });

  return ok(
    {
      photoId: resolvedPhoto.photoId,
      fileName: resolvedPhoto.fileName,
      format: resolvedPhoto.format,
      fileSizeBytes: resolvedPhoto.fileSizeBytes,
      ...(resolvedPhoto.metadata ? { metadata: resolvedPhoto.metadata } : {}),
      displayDimensions: resolvedPhoto.displayDimensions!,
      chronology: resolvedPhoto.chronology!,
      archived: resolvedPhoto.archived,
      collection,
      displayAccess: {
        url: displayAccess.url,
        expiresAt: conservativeExpiresAt([displayAccess.expiresInSeconds]),
      },
      ...(newer ? { newerPhotoId: newer.photoId } : {}),
      ...(older ? { olderPhotoId: older.photoId } : {}),
    } satisfies ViewerBootstrapResponse,
    { headers: NO_STORE_HEADERS },
  );
};

const collectionOf = (photo: Photo): PhotoCollection => (photo.archived ? "archived" : "active");

/** True when a concurrent Archive/Restore or Adjust/Revert moved this Photo's projection. */
const movedSince = (before: Photo, after: Photo): boolean =>
  before.archived !== after.archived ||
  before.chronology?.active.revision !== after.chronology?.active.revision;

const queryNeighbours = (
  album: PersonalAlbum,
  photo: Photo,
  collection: PhotoCollection,
): Promise<[TimelineProjection | undefined, TimelineProjection | undefined]> =>
  Promise.all([
    album.queryAdjacentProjection({
      collection,
      capturedAt: photo.chronology!.active.capturedAt,
      addedAt: photo.uploadRequestedAt!,
      photoId: photo.photoId,
      direction: "newer",
    }),
    album.queryAdjacentProjection({
      collection,
      capturedAt: photo.chronology!.active.capturedAt,
      addedAt: photo.uploadRequestedAt!,
      photoId: photo.photoId,
      direction: "older",
    }),
  ]);

type ResolveResult =
  | { outcome: "resolved"; photo: Photo; collection: PhotoCollection; newer?: TimelineProjection; older?: TimelineProjection }
  | { outcome: "concurrent_movement" };

/**
 * Reads live neighbours for the Photo's current projection, then re-reads the
 * Photo to confirm nothing moved while the neighbour queries ran. One retry
 * absorbs a single concurrent Archive/Restore or Adjust/Revert; a second
 * observed move gives up with a recoverable conflict (ADR-0060).
 */
const resolveWithOneRetry = async ({
  album,
  photoId,
  photo,
}: {
  album: PersonalAlbum;
  photoId: string;
  photo: Photo;
}): Promise<ResolveResult> => {
  let current = photo;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const collection = collectionOf(current);
    const [newer, older] = await queryNeighbours(album, current, collection);
    const refreshed = await album.getPhoto(photoId);
    if (refreshed && !movedSince(current, refreshed)) {
      return { outcome: "resolved", photo: refreshed, collection, ...(newer ? { newer } : {}), ...(older ? { older } : {}) };
    }
    if (!refreshed) {
      return { outcome: "concurrent_movement" };
    }
    current = refreshed;
  }
  return { outcome: "concurrent_movement" };
};

const parseCollection = (raw: string | undefined): PhotoCollection | "invalid" | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  return raw === "active" || raw === "archived" ? raw : "invalid";
};
