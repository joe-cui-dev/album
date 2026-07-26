import type {
  ListCollectionPhotosResponse,
  PhotoCollection,
  TimelineThumbnailAccessResponse,
} from "@album/shared";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

export interface LoadCall {
  collection: PhotoCollection;
  cursor?: string;
  startAt?: string;
  signal: AbortSignal;
}

export interface RenewalCall {
  photoIds: string[];
  signal: AbortSignal;
}

export interface TestAlbumBrowsingPortOptions {
  /**
   * When true (the default), an aborted request's promise auto-rejects with an AbortError, like a
   * real fetch. Set false to simulate a transport that settles *after* abort -- the request stays
   * pending, `signal.aborted` becomes true, and the test must still explicitly resolve/reject it --
   * proving generation fencing catches a late settlement even when cancellation loses the race.
   */
  rejectOnAbort?: boolean;
}

export interface TestAlbumBrowsingPort {
  port: AlbumBrowsingPort;
  loadCalls: LoadCall[];
  renewalCalls: RenewalCall[];
  /** Resolves/rejects a specific call by its index in `loadCalls`/`renewalCalls`, in any order. */
  resolveLoad(index: number, response: ListCollectionPhotosResponse): void;
  rejectLoad(index: number, error: unknown): void;
  resolveRenewal(index: number, response: TimelineThumbnailAccessResponse): void;
  rejectRenewal(index: number, error: unknown): void;
  /** Resolves/rejects the oldest not-yet-settled call, in call order. */
  resolveNextLoad(response: ListCollectionPhotosResponse): void;
  rejectNextLoad(error: unknown): void;
  resolveNextRenewal(response: TimelineThumbnailAccessResponse): void;
  rejectNextRenewal(error: unknown): void;
}

/** A fully controllable Browsing Window port for deep-module tests: every call queues until the test resolves it. */
export const createTestAlbumBrowsingPort = (options: TestAlbumBrowsingPortOptions = {}): TestAlbumBrowsingPort => {
  const rejectOnAbort = options.rejectOnAbort ?? true;
  const loadCalls: LoadCall[] = [];
  const renewalCalls: RenewalCall[] = [];
  const loadDeferreds: Array<Deferred<ListCollectionPhotosResponse>> = [];
  const renewalDeferreds: Array<Deferred<TimelineThumbnailAccessResponse>> = [];

  const nextUnsettledIndex = <T>(deferreds: Array<Deferred<T>>): number | undefined => {
    const index = deferreds.findIndex((deferred) => !deferred.settled);
    return index === -1 ? undefined : index;
  };

  const port: AlbumBrowsingPort = {
    loadCollectionPage: ({ collection, cursor, startAt, signal }) => {
      loadCalls.push({ collection, signal, ...(cursor !== undefined ? { cursor } : {}), ...(startAt !== undefined ? { startAt } : {}) });
      return new Promise((resolve, reject) => {
        const deferred: Deferred<ListCollectionPhotosResponse> = {
          settled: false,
          resolve: (value) => {
            deferred.settled = true;
            resolve(value);
          },
          reject: (error) => {
            deferred.settled = true;
            reject(error);
          },
        };
        loadDeferreds.push(deferred);
        if (rejectOnAbort) {
          signal.addEventListener("abort", () => deferred.reject(new DOMException("Aborted", "AbortError")));
        }
      });
    },
    renewThumbnailAccess: ({ photoIds, signal }) => {
      renewalCalls.push({ photoIds, signal });
      return new Promise((resolve, reject) => {
        const deferred: Deferred<TimelineThumbnailAccessResponse> = {
          settled: false,
          resolve: (value) => {
            deferred.settled = true;
            resolve(value);
          },
          reject: (error) => {
            deferred.settled = true;
            reject(error);
          },
        };
        renewalDeferreds.push(deferred);
        if (rejectOnAbort) {
          signal.addEventListener("abort", () => deferred.reject(new DOMException("Aborted", "AbortError")));
        }
      });
    },
  };

  return {
    port,
    loadCalls,
    renewalCalls,
    resolveLoad: (index, response) => loadDeferreds[index]?.resolve(response),
    rejectLoad: (index, error) => loadDeferreds[index]?.reject(error),
    resolveRenewal: (index, response) => renewalDeferreds[index]?.resolve(response),
    rejectRenewal: (index, error) => renewalDeferreds[index]?.reject(error),
    resolveNextLoad: (response) => {
      const index = nextUnsettledIndex(loadDeferreds);
      if (index !== undefined) {
        loadDeferreds[index]!.resolve(response);
      }
    },
    rejectNextLoad: (error) => {
      const index = nextUnsettledIndex(loadDeferreds);
      if (index !== undefined) {
        loadDeferreds[index]!.reject(error);
      }
    },
    resolveNextRenewal: (response) => {
      const index = nextUnsettledIndex(renewalDeferreds);
      if (index !== undefined) {
        renewalDeferreds[index]!.resolve(response);
      }
    },
    rejectNextRenewal: (error) => {
      const index = nextUnsettledIndex(renewalDeferreds);
      if (index !== undefined) {
        renewalDeferreds[index]!.reject(error);
      }
    },
  };
};
