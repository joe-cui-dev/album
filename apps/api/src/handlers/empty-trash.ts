import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { noContent } from "../http.js";
import { permanentlyDeletePhoto } from "../permanent-deletion.js";
import { photoObjectStore } from "../store/configured-store.js";
import type { PhotoObjectStore } from "../store/photo-objects.js";
import { mapConcurrentModificationError } from "./mutation-errors.js";

const PAGE_SIZE = 100;

export const emptyTrashHandler: APIGatewayProxyHandlerV2 = withAuth((context) =>
  handleEmptyTrash({ ...context, deps: { photoObjects: photoObjectStore } }),
);

/** Empties one User's Trash. Each Photo keeps its own atomic metadata transaction. */
export const handleEmptyTrash = async ({
  album,
  deps,
}: AuthedContext & {
  deps: { photoObjects: PhotoObjectStore };
}): Promise<APIGatewayProxyStructuredResultV2> => {
  let after: { sortKey: string } | undefined;
  do {
    const page = await album.queryTimelinePage({ collection: "trashed", limit: PAGE_SIZE, ...(after ? { after } : {}) });
    for (const projection of page.projections) {
      try {
        await permanentlyDeletePhoto({ album, photoObjects: deps.photoObjects, photoId: projection.photoId });
      } catch (error) {
        return mapConcurrentModificationError(error);
      }
    }
    after = page.lastSortKey ? { sortKey: page.lastSortKey } : undefined;
  } while (after);
  return noContent();
};
