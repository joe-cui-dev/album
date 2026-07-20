import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { TimelineThumbnailAccessRequest, TimelineThumbnailAccessResponse } from "@album/shared";
import { buildTimelineThumbnailSources } from "../thumbnail-sources.js";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, ok } from "../http.js";
import { photoObjectStore } from "../store/configured-store.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";

interface TimelineThumbnailAccessDeps {
  photoObjects: PhotoObjectStore;
}

export const handler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleTimelineThumbnailAccess({
    ...context,
    body: event.body,
    deps: { photoObjects: photoObjectStore },
  }),
);

export const handleTimelineThumbnailAccess = async ({
  album,
  body,
  deps,
}: AuthedContext & {
  body: string | undefined;
  deps: TimelineThumbnailAccessDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!body) {
    return badRequest("Missing request body");
  }
  const request = parseJson<TimelineThumbnailAccessRequest>(body);
  if (!Array.isArray(request.photoIds) || request.photoIds.some((id) => typeof id !== "string")) {
    return badRequest("photoIds must be an array of strings");
  }
  if (request.photoIds.length === 0) {
    return badRequest("At least one photoId is required");
  }
  if (request.photoIds.length > 100) {
    return badRequest("At most 100 photoIds are allowed");
  }

  const photos = await album.getPhotosByIds(request.photoIds);
  const readyPhotos = photos.filter(
    (photo) => photo.processingState === "ready" && photo.timelineThumbnails !== undefined,
  );

  const results = await Promise.all(
    readyPhotos.map(async (photo) => {
      const timelineThumbnails = photo.timelineThumbnails!;
      const [small, large] = await Promise.all([
        deps.photoObjects.presignDownload({ objectKey: timelineThumbnails.small.objectKey }),
        deps.photoObjects.presignDownload({ objectKey: timelineThumbnails.large.objectKey }),
      ]);
      return {
        photoId: photo.photoId,
        timelineThumbnailSources: buildTimelineThumbnailSources({
          small: { url: small.url, dimensions: timelineThumbnails.small.dimensions },
          large: { url: large.url, dimensions: timelineThumbnails.large.dimensions },
        }),
      };
    }),
  );

  return ok(
    { photos: results } satisfies TimelineThumbnailAccessResponse,
    { headers: { "cache-control": "private, no-store" } },
  );
};

const parseJson = <T>(body: string): T => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return { photoIds: [] } as T;
  }
};
