import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { ArchiveMembershipResponse } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, json, ok } from "../http.js";
import { mapConcurrentModificationError } from "./mutation-errors.js";

export const archiveMembershipHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleSetArchiveMembership({
    ...context,
    photoId: event.pathParameters?.photoId,
    archived: true,
  }),
);

export const restoreMembershipHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleSetArchiveMembership({
    ...context,
    photoId: event.pathParameters?.photoId,
    archived: false,
  }),
);

export const handleSetArchiveMembership = async ({
  album,
  photoId,
  archived,
}: AuthedContext & {
  photoId: string | undefined;
  archived: boolean;
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
    await album.setArchiveMembershipV2({ photoId, archived });
  } catch (error) {
    return mapConcurrentModificationError(error);
  }

  return ok({ photoId, archived } satisfies ArchiveMembershipResponse);
};
