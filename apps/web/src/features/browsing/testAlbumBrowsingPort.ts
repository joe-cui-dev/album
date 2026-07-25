import type {
  ListCollectionPhotosResponse,
  PhotoCollection,
  TimelineThumbnailAccessResponse,
} from "@album/shared";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface LoadCall {
  collection: PhotoCollection;
  cursor?: string;
  startAt?: string;
}

export interface RenewalCall {
  photoIds: string[];
  signal: AbortSignal;
}

export interface TestAlbumBrowsingPort {
  port: AlbumBrowsingPort;
  loadCalls: LoadCall[];
  renewalCalls: RenewalCall[];
  resolveNextLoad(response: ListCollectionPhotosResponse): void;
  rejectNextLoad(error: unknown): void;
  resolveNextRenewal(response: TimelineThumbnailAccessResponse): void;
  rejectNextRenewal(error: unknown): void;
}

/** A fully controllable Browsing Window port for deep-module tests: every call queues until the test resolves it. */
export const createTestAlbumBrowsingPort = (): TestAlbumBrowsingPort => {
  const loadCalls: LoadCall[] = [];
  const renewalCalls: RenewalCall[] = [];
  const pendingLoads: Array<Deferred<ListCollectionPhotosResponse>> = [];
  const pendingRenewals: Array<Deferred<TimelineThumbnailAccessResponse>> = [];

  const port: AlbumBrowsingPort = {
    loadCollectionPage: ({ collection, cursor, startAt, signal }) => {
      loadCalls.push({ collection, ...(cursor !== undefined ? { cursor } : {}), ...(startAt !== undefined ? { startAt } : {}) });
      return new Promise((resolve, reject) => {
        pendingLoads.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    renewThumbnailAccess: ({ photoIds, signal }) => {
      renewalCalls.push({ photoIds, signal });
      return new Promise((resolve, reject) => {
        pendingRenewals.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  };

  return {
    port,
    loadCalls,
    renewalCalls,
    resolveNextLoad: (response) => pendingLoads.shift()?.resolve(response),
    rejectNextLoad: (error) => pendingLoads.shift()?.reject(error),
    resolveNextRenewal: (response) => pendingRenewals.shift()?.resolve(response),
    rejectNextRenewal: (error) => pendingRenewals.shift()?.reject(error),
  };
};
