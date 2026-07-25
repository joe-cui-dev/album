import type { PhotoCollection, ViewerBootstrapResponse } from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";

/**
 * PhotoViewer's owned internal network seam (ADR-0056). Production gets an
 * HTTP adapter, tests an in-memory or scripted one; the deep module never
 * imports the global HTTP client directly.
 */
export interface PhotoViewerPort {
  loadViewerBootstrap(input: {
    photoId: string;
    collection?: PhotoCollection;
    signal: AbortSignal;
  }): Promise<ViewerBootstrapResponse>;
}

export const createHttpPhotoViewerPort = (): PhotoViewerPort => ({
  loadViewerBootstrap: ({ photoId, collection, signal }) => {
    const suffix = collection !== undefined ? `?collection=${collection}` : "";
    return albumTransport.request(`/photos/${photoId}/viewer${suffix}`, { signal });
  },
});
