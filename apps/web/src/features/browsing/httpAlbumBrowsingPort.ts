import type { PhotoCollection } from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";

const pathForCollection = (collection: PhotoCollection): string => {
  switch (collection) {
    case "active":
      return "/timeline";
    case "trashed":
      return "/trash";
    case "favourite":
      return "/favourites";
  }
};

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
