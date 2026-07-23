import type {
  ArchiveMembershipResponse,
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
  setArchiveMembership(input: {
    photoId: string;
    archived: boolean;
    signal: AbortSignal;
  }): Promise<ArchiveMembershipResponse>;

  retryProcessing(input: { photoId: string; signal: AbortSignal }): Promise<RetryProcessingResponse>;

  presignOriginalDownload(input: {
    photoId: string;
    signal: AbortSignal;
  }): Promise<CreateTemporaryPhotoUrlResponse>;
}

export const createHttpAlbumMutationsPort = (): AlbumMutationsPort => ({
  setArchiveMembership: ({ photoId, archived, signal }) =>
    albumTransport.request(`/photos/${photoId}/archive`, {
      method: archived ? "PUT" : "DELETE",
      signal,
    }),

  retryProcessing: ({ photoId, signal }) =>
    albumTransport.request(`/photos/${photoId}/retry-processing`, { method: "POST", signal }),

  presignOriginalDownload: ({ photoId, signal }) =>
    albumTransport.request(`/photos/${photoId}/original-download`, { method: "POST", signal }),
});
