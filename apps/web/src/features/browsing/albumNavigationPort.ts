import type { AlbumNavigationResponse } from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";

/** Owned read seam for Album Navigation counts, mirroring `AlbumBrowsingPort` (ADR-0066). */
export interface AlbumNavigationPort {
  loadAlbumNavigation(input: { signal: AbortSignal }): Promise<AlbumNavigationResponse>;
}

export const createHttpAlbumNavigationPort = (): AlbumNavigationPort => ({
  loadAlbumNavigation: ({ signal }) => albumTransport.request("/album-navigation", { signal }),
});
