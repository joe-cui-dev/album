import { describe, expect, it } from "vitest";
import type { TimelineThumbnailSources } from "@album/shared";
import { createThumbnailLeaseCache } from "./thumbnailLeaseCache.js";

const sources = (url: string): TimelineThumbnailSources => ({ large: { url, dimensions: { width: 640, height: 320 } } });

describe("createThumbnailLeaseCache", () => {
  it("ingests a lease at revision 1 and bumps the revision on each subsequent put", () => {
    const cache = createThumbnailLeaseCache(10);

    expect(cache.put("a", sources("a1"), 1000)).toEqual({ revision: 1, evictedIds: [] });
    expect(cache.get("a")).toEqual({ sources: sources("a1"), expiresAtMs: 1000, revision: 1 });

    expect(cache.put("a", sources("a2"), 2000)).toEqual({ revision: 2, evictedIds: [] });
    expect(cache.get("a")?.revision).toBe(2);
  });

  it("never evicts an id in the active demand set, even past the limit", () => {
    const cache = createThumbnailLeaseCache(2);
    cache.setDemand(new Set(["a", "b", "c"]));

    cache.put("a", sources("a"), 1000);
    cache.put("b", sources("b"), 1000);
    cache.put("c", sources("c"), 1000);

    expect(cache.size()).toBe(3);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("evicts the least-recently-used non-demand id once the bound is exceeded", () => {
    const cache = createThumbnailLeaseCache(2);
    cache.put("a", sources("a"), 1000);
    cache.put("b", sources("b"), 1000);
    cache.put("c", sources("c"), 1000);

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("moves an id that leaves the demand set back into non-demand eviction order as most-recently-used", () => {
    const cache = createThumbnailLeaseCache(2);
    cache.setDemand(new Set(["a"]));
    cache.put("a", sources("a"), 1000);
    cache.put("b", sources("b"), 1000);
    cache.put("c", sources("c"), 1000);
    // "a" is demand, so only "b"/"c" compete for the 2-slot non-demand bound; both fit.
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);

    // "a" leaves demand and immediately joins a 3-entry non-demand pool over the 2-slot bound;
    // it's the most-recently-used of the three, so "b" (the oldest) is evicted, not "a" or "c".
    cache.setDemand(new Set());

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("clear discards every lease and returns the discarded ids", () => {
    const cache = createThumbnailLeaseCache(10);
    cache.put("a", sources("a"), 1000);
    cache.put("b", sources("b"), 1000);

    expect(cache.clear().sort()).toEqual(["a", "b"]);
    expect(cache.size()).toBe(0);
    expect(cache.has("a")).toBe(false);
  });

  it("delete removes a single lease without disturbing others", () => {
    const cache = createThumbnailLeaseCache(10);
    cache.put("a", sources("a"), 1000);
    cache.put("b", sources("b"), 1000);

    cache.delete("a");

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
  });
});
