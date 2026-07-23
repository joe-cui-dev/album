import type {
  ListCollectionPhotosV2Response,
  PhotoCollection,
  TimelineThumbnailAccessResponse,
} from "@album/shared";

/**
 * The Browsing Window's owned internal network seam (ADR-0055). Production
 * gets an HTTP adapter, tests an in-memory or scripted one; the deep module
 * never imports the global HTTP client directly (ADR-0065).
 */
export interface AlbumBrowsingPort {
  loadCollectionPage(input: {
    collection: PhotoCollection;
    cursor?: string;
    startAt?: string;
    signal: AbortSignal;
  }): Promise<ListCollectionPhotosV2Response>;

  renewThumbnailAccess(input: {
    photoIds: string[];
    signal: AbortSignal;
  }): Promise<TimelineThumbnailAccessResponse>;
}
