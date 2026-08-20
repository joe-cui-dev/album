import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { MembershipCollection, Photo, PhotoCollection, ViewerBootstrapResponse } from "@album/shared";
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
    return badRequest("collection must be active, trashed, or favourite");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "ready" || !photo.chronology || !photo.uploadRequestedAt) {
    return json(409, { message: "Photo is not Ready" });
  }

  // `currentCollection` answers a membership question (ADR-0061): it is never `favourite`,
  // because a Photo can be favourited while also belonging to `active` or `trashed`.
  const currentCollection = collectionOf(photo);
  if (requestedCollection === "favourite") {
    if (photo.trashed || !photo.favourite) {
      return conflict("photo_collection_changed", "The Photo's collection changed", {
        currentCollection,
      });
    }
  } else if (requestedCollection && requestedCollection !== currentCollection) {
    return conflict("photo_collection_changed", "The Photo's collection changed", {
      currentCollection,
    });
  }

  const resolution = await resolveWithOneRetry({
    album,
    photoId,
    photo,
    target: requestedCollection === "favourite" ? "favourite" : "membership",
  });
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
      trashed: resolvedPhoto.trashed,
      favourite: resolvedPhoto.favourite,
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

const collectionOf = (photo: Photo): MembershipCollection => (photo.trashed ? "trashed" : "active");

/** True when a concurrent Trash/Restore or Adjust/Revert moved this Photo's projection. */
const movedSince = (before: Photo, after: Photo): boolean =>
  before.trashed !== after.trashed ||
  before.chronology?.active.revision !== after.chronology?.active.revision;

/** True when a concurrent change took the Photo out of the `favourite` collection: trashed, unfavourited, or its chronology moved. */
const leftFavouriteSince = (before: Photo, after: Photo): boolean =>
  after.trashed ||
  !after.favourite ||
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
 * absorbs a single concurrent Trash/Restore or Adjust/Revert; a second
 * observed move gives up with a recoverable conflict (ADR-0060). `target`
 * "favourite" pins the Viewer Sequence to the `favourite` collection (already
 * validated by the caller); "membership" re-derives active/trashed from the
 * Photo on every attempt, which also covers a direct URL's inferred collection.
 */
const resolveWithOneRetry = async ({
  album,
  photoId,
  photo,
  target,
}: {
  album: PersonalAlbum;
  photoId: string;
  photo: Photo;
  target: "membership" | "favourite";
}): Promise<ResolveResult> => {
  let current = photo;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const collection: PhotoCollection = target === "favourite" ? "favourite" : collectionOf(current);
    const [newer, older] = await queryNeighbours(album, current, collection);
    const refreshed = await album.getPhoto(photoId);
    if (!refreshed) {
      return { outcome: "concurrent_movement" };
    }
    const moved = target === "favourite" ? leftFavouriteSince(current, refreshed) : movedSince(current, refreshed);
    if (!moved) {
      return { outcome: "resolved", photo: refreshed, collection, ...(newer ? { newer } : {}), ...(older ? { older } : {}) };
    }
    current = refreshed;
  }
  return { outcome: "concurrent_movement" };
};

const parseCollection = (raw: string | undefined): PhotoCollection | "invalid" | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  return raw === "active" || raw === "trashed" || raw === "favourite" ? raw : "invalid";
};
