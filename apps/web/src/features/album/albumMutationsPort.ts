import type {
  TrashMembershipResponse,
  CreateTemporaryPhotoUrlResponse,
  RetryProcessingResponse,
} from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";

/**
 * `albumMutations`' owned internal network seam (ADR-0066, ADR-0068).
 * Production gets an HTTP adapter, tests an in-memory or scripted one; the
 * deep module never imports the global HTTP client directly.
 */
export interface AlbumMutationsPort {
  setTrashMembership(input: {
    photoId: string;
    trashed: boolean;
    signal: AbortSignal;
  }): Promise<TrashMembershipResponse>;

  retryProcessing(input: { photoId: string; signal: AbortSignal }): Promise<RetryProcessingResponse>;

  presignOriginalDownload(input: {
    photoId: string;
    signal: AbortSignal;
  }): Promise<CreateTemporaryPhotoUrlResponse>;
}

export const createHttpAlbumMutationsPort = (): AlbumMutationsPort => ({
  setTrashMembership: ({ photoId, trashed, signal }) =>
    albumTransport.request(`/photos/${photoId}/trash`, {
      method: trashed ? "PUT" : "DELETE",
      signal,
    }),

  retryProcessing: ({ photoId, signal }) =>
    albumTransport.request(`/photos/${photoId}/retry-processing`, { method: "POST", signal }),

  presignOriginalDownload: ({ photoId, signal }) =>
    albumTransport.request(`/photos/${photoId}/original-download`, { method: "POST", signal }),
});
