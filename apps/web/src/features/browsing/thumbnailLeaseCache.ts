import type { TimelineThumbnailSources } from "@album/shared";

/** ADR-0050/0051: one Photo's temporary Thumbnail Access, keyed by a monotonically increasing
 * revision so a late outcome from an older URL can never affect newer access. */
export interface ThumbnailLease {
  sources: TimelineThumbnailSources;
  expiresAtMs: number;
  revision: number;
}

/**
 * A pure, count-bounded LRU of temporary Thumbnail Access. Active-demand ids are exempt from
 * eviction; the least-recently-used non-demand id is discarded once the bound is exceeded
 * (ADR-0050). Not itself async or time-aware -- the caller decides when a lease is due for
 * renewal from its own clock and `expiresAtMs`.
 */
export interface ThumbnailLeaseCache {
  get(photoId: string): ThumbnailLease | undefined;
  has(photoId: string): boolean;
  /** Ingests or refreshes a lease, bumping its revision. May evict another non-demand id to stay within bound. */
  put(photoId: string, sources: TimelineThumbnailSources, expiresAtMs: number): { revision: number; evictedIds: string[] };
  delete(photoId: string): void;
  /** Sets the current active-demand set (visible + soon-visible + focus-pinned); recomputes eviction and returns any evicted ids. */
  setDemand(photoIds: ReadonlySet<string>): string[];
  size(): number;
  /** Discards every lease (e.g. on deactivate); returns the discarded ids. */
  clear(): string[];
}

export const createThumbnailLeaseCache = (nonDemandLimit: number): ThumbnailLeaseCache => {
  const leases = new Map<string, ThumbnailLease>();
  // Non-demand ids only, oldest (least-recently touched) first.
  const lru: string[] = [];
  let demand = new Set<string>();

  const removeFromLru = (photoId: string): void => {
    const index = lru.indexOf(photoId);
    if (index !== -1) {
      lru.splice(index, 1);
    }
  };

  const touchLru = (photoId: string): void => {
    if (demand.has(photoId)) {
      return;
    }
    removeFromLru(photoId);
    lru.push(photoId);
  };

  const evictOverflow = (): string[] => {
    const evicted: string[] = [];
    while (lru.length > nonDemandLimit) {
      const evictedId = lru.shift();
      if (evictedId !== undefined) {
        leases.delete(evictedId);
        evicted.push(evictedId);
      }
    }
    return evicted;
  };

  return {
    get: (photoId) => leases.get(photoId),
    has: (photoId) => leases.has(photoId),
    put: (photoId, sources, expiresAtMs) => {
      const revision = (leases.get(photoId)?.revision ?? 0) + 1;
      leases.set(photoId, { sources, expiresAtMs, revision });
      touchLru(photoId);
      return { revision, evictedIds: evictOverflow() };
    },
    delete: (photoId) => {
      leases.delete(photoId);
      removeFromLru(photoId);
    },
    setDemand: (photoIds) => {
      demand = new Set(photoIds);
      for (const photoId of demand) {
        removeFromLru(photoId);
      }
      // An id that just left demand becomes the most-recently-used non-demand entry -- it was
      // visible a moment ago, so it's the least likely of the non-demand set to be evicted next.
      for (const photoId of leases.keys()) {
        if (!demand.has(photoId) && !lru.includes(photoId)) {
          lru.push(photoId);
        }
      }
      return evictOverflow();
    },
    size: () => leases.size,
    clear: () => {
      const ids = [...leases.keys()];
      leases.clear();
      lru.length = 0;
      demand = new Set();
      return ids;
    },
  };
};
