import type {
  TrashMembershipResponse,
  FavouriteMembershipResponse,
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

  setFavourite(input: {
    photoId: string;
    favourite: boolean;
    signal: AbortSignal;
  }): Promise<FavouriteMembershipResponse>;

  retryProcessing(input: { photoId: string; signal: AbortSignal }): Promise<RetryProcessingResponse>;

  presignOriginalDownload(input: {
    photoId: string;
    signal: AbortSignal;
  }): Promise<CreateTemporaryPhotoUrlResponse>;
  permanentlyDeletePhoto(input: { photoId: string; signal: AbortSignal }): Promise<void>;
  emptyTrash(input: { signal: AbortSignal }): Promise<void>;
}

export const createHttpAlbumMutationsPort = (): AlbumMutationsPort => ({
  setTrashMembership: ({ photoId, trashed, signal }) =>
    albumTransport.request(`/photos/${photoId}/trash`, {
      method: trashed ? "PUT" : "DELETE",
      signal,
    }),

  setFavourite: ({ photoId, favourite, signal }) =>
    albumTransport.request(`/photos/${photoId}/favourite`, {
      method: favourite ? "PUT" : "DELETE",
      signal,
    }),

  retryProcessing: ({ photoId, signal }) =>
    albumTransport.request(`/photos/${photoId}/retry-processing`, { method: "POST", signal }),

  presignOriginalDownload: ({ photoId, signal }) =>
    albumTransport.request(`/photos/${photoId}/original-download`, { method: "POST", signal }),

  permanentlyDeletePhoto: ({ photoId, signal }) =>
    albumTransport.request<void>(`/photos/${photoId}`, { method: "DELETE", signal }),

  emptyTrash: ({ signal }) => albumTransport.request<void>("/trash", { method: "DELETE", signal }),
});
