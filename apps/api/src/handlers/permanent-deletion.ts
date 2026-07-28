import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { noContent, badRequest, json } from "../http.js";
import { permanentlyDeletePhoto } from "../permanent-deletion.js";
import { photoObjectStore } from "../store/configured-store.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";
import { mapConcurrentModificationError } from "./mutation-errors.js";

export const permanentDeletionHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handlePermanentDeletion({
    ...context,
    photoId: event.pathParameters?.photoId,
    deps: { photoObjects: photoObjectStore },
  }),
);

export const handlePermanentDeletion = async ({
  album,
  photoId,
  deps,
}: AuthedContext & {
  photoId: string | undefined;
  deps: { photoObjects: PhotoObjectStore };
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) return badRequest("photoId is required");
  let result: Awaited<ReturnType<typeof permanentlyDeletePhoto>>;
  try {
    result = await permanentlyDeletePhoto({ album, photoId, photoObjects: deps.photoObjects });
  } catch (error) {
    return mapConcurrentModificationError(error);
  }
  if (result === "ineligible") {
    return json(409, { message: "Only Deleted Photos can be permanently deleted" });
  }
  return noContent();
};
