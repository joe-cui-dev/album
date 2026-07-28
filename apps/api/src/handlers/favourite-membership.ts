import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { FavouriteMembershipResponse } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, json, ok } from "../http.js";
import { mapConcurrentModificationError } from "./mutation-errors.js";

export const favouriteMembershipHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleSetFavourite({
    ...context,
    photoId: event.pathParameters?.photoId,
    favourite: true,
  }),
);

export const unfavouriteMembershipHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleSetFavourite({
    ...context,
    photoId: event.pathParameters?.photoId,
    favourite: false,
  }),
);

export const handleSetFavourite = async ({
  album,
  photoId,
  favourite,
}: AuthedContext & {
  photoId: string | undefined;
  favourite: boolean;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "ready" || !photo.chronology) {
    return json(409, { message: "Photo is not Ready" });
  }

  try {
    await album.setFavourite({ photoId, favourite });
  } catch (error) {
    return mapConcurrentModificationError(error);
  }

  return ok({ photoId, favourite } satisfies FavouriteMembershipResponse);
};
