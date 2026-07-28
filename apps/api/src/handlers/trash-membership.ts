import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { TrashMembershipResponse } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, json, ok } from "../http.js";
import { mapConcurrentModificationError } from "./mutation-errors.js";

export const trashMembershipHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleSetTrashMembership({
    ...context,
    photoId: event.pathParameters?.photoId,
    trashed: true,
  }),
);

export const restoreMembershipHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleSetTrashMembership({
    ...context,
    photoId: event.pathParameters?.photoId,
    trashed: false,
  }),
);

export const handleSetTrashMembership = async ({
  album,
  photoId,
  trashed,
}: AuthedContext & {
  photoId: string | undefined;
  trashed: boolean;
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
    await album.setTrashMembership({ photoId, trashed });
  } catch (error) {
    return mapConcurrentModificationError(error);
  }

  return ok({ photoId, trashed } satisfies TrashMembershipResponse);
};
