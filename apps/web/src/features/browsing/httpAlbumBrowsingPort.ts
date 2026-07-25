import { albumTransport } from "../../lib/albumTransport.js";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";

const pathForCollection = (collection: "active" | "archived"): string =>
  collection === "active" ? "/timeline" : "/archive";

export const createHttpAlbumBrowsingPort = (): AlbumBrowsingPort => ({
  loadCollectionPage: ({ collection, cursor, startAt, signal }) => {
    const params = new URLSearchParams();
    if (cursor !== undefined) {
      params.set("cursor", cursor);
    }
    if (startAt !== undefined) {
      params.set("startAt", startAt);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return albumTransport.request(`${pathForCollection(collection)}${suffix}`, { signal });
  },

  renewThumbnailAccess: ({ photoIds, signal }) =>
    albumTransport.request("/timeline-thumbnail-access", {
      method: "POST",
      body: { photoIds },
      signal,
    }),
});
