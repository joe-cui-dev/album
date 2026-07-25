import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelinePhoto } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import { createBrowsingWindow, type BrowsingWindow } from "./browsingWindow.js";
import { createTestAlbumBrowsingPort, type TestAlbumBrowsingPort } from "./testAlbumBrowsingPort.js";

const layout = { containerWidth: 1000, spacing: 10, targetRowHeight: 200 };

const photo = (
  photoId: string,
  overrides: Partial<TimelinePhoto> = {},
): TimelinePhoto => ({
  photoId,
  fileName: `${photoId}.jpg`,
  capturedAt: { precision: "day", localDate: "2024-06-15" },
  addedAt: "2026-01-01T00:00:00.000Z",
  displayDimensions: { width: 200, height: 100 },
  timelineThumbnailSources: {
    large: { url: `https://example.invalid/${photoId}-large.jpg`, dimensions: { width: 640, height: 320 } },
  },
  ...overrides,
});

describe("createBrowsingWindow", () => {
  let test: TestAlbumBrowsingPort;
  let window_: BrowsingWindow | undefined;

  beforeEach(() => {
    test = createTestAlbumBrowsingPort();
  });

  afterEach(() => {
    window_?.dispose();
  });

  it("kicks off an initial load for the given collection and startAt", () => {
    window_ = createBrowsingWindow({ collection: "archived", startAt: "2024-06", port: test.port, layout });

    expect(test.loadCalls).toEqual([{ collection: "archived", startAt: "2024-06" }]);
    expect(window_.getSnapshot().isLoadingInitial).toBe(true);
  });

  it("seeds from an already-fetched initialPage instead of issuing a redundant load (ADR-0058)", () => {
    window_ = createBrowsingWindow({
      collection: "active",
      startAt: "2024-06",
      port: test.port,
      layout,
      initialPage: { photos: [photo("a"), photo("b")], expiresAt: "2030-01-01T00:00:00.000Z" },
    });

    expect(test.loadCalls).toEqual([]);
    const snapshot = window_.getSnapshot();
    expect(snapshot.isLoadingInitial).toBe(false);
    expect([...snapshot.descriptorsById.keys()]).toEqual(["a", "b"]);
    expect(snapshot.isExhausted).toBe(true);
  });

  it("applies the first page into descriptors and layout, newest first", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });

    test.resolveNextLoad({ photos: [photo("a"), photo("b")], expiresAt: "2030-01-01T00:00:00.000Z" });
    await flush();

    const snapshot = window_.getSnapshot();
    expect(snapshot.isLoadingInitial).toBe(false);
    expect(snapshot.photoCount).toBe(2);
    expect([...snapshot.descriptorsById.keys()]).toEqual(["a", "b"]);
    expect(snapshot.isExhausted).toBe(true);
    const rows = snapshot.layoutItems.filter((item) => item.kind === "row");
    expect(rows[0]).toMatchObject({ photoIds: ["a", "b"] });
  });

  it("ignores a duplicate Photo id from a later page (first-seen wins)", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
    await flush();

    window_.intents.loadMore();
    test.resolveNextLoad({ photos: [photo("a"), photo("b")] });
    await flush();

    expect(window_.getSnapshot().photoCount).toBe(2);
    expect([...window_.getSnapshot().descriptorsById.keys()]).toEqual(["a", "b"]);
  });

  it("is single-flight: a second loadMore while one is in flight is a no-op", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
    await flush();

    window_.intents.loadMore();
    window_.intents.loadMore();
    expect(test.loadCalls).toHaveLength(2);
  });

  it("does not load more once exhausted", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.resolveNextLoad({ photos: [photo("a")] });
    await flush();

    window_.intents.loadMore();
    expect(test.loadCalls).toHaveLength(1);
    expect(window_.getSnapshot().isExhausted).toBe(true);
  });

  it("withholds the last period's incomplete tail while the cursor continues, and surfaces the load error otherwise", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    // A single small square photo can never fill a 1000px row on its own.
    test.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
    await flush();

    let snapshot = window_.getSnapshot();
    expect(snapshot.layoutItems.some((item) => item.kind === "row")).toBe(false);
    expect(snapshot.incompleteTailPhotoIds).toEqual(["a"]);

    window_.intents.loadMore();
    test.rejectNextLoad(new AlbumTransportError("network", "boom"));
    await flush();

    snapshot = window_.getSnapshot();
    expect(snapshot.loadError).toBe("network");
    expect(snapshot.isLoadingMore).toBe(false);
    // A failed load also relaxes the withheld tail into a visible final row.
    expect(snapshot.incompleteTailPhotoIds).toBeUndefined();
    expect(snapshot.layoutItems.some((item) => item.kind === "row" && item.photoIds.includes("a"))).toBe(true);
  });

  it("retry re-issues the failed load and clears loadError once it succeeds", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.rejectNextLoad(new AlbumTransportError("network", "boom"));
    await flush();
    expect(window_.getSnapshot().loadError).toBe("network");

    window_.intents.retry();
    expect(test.loadCalls).toHaveLength(2);
    test.resolveNextLoad({ photos: [photo("a")] });
    await flush();

    expect(window_.getSnapshot().loadError).toBeUndefined();
  });

  it("does not load more while a load previously failed, until retry() clears it", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.rejectNextLoad(new AlbumTransportError("network", "boom"));
    await flush();

    window_.intents.loadMore();
    expect(test.loadCalls).toHaveLength(1);
  });

  it("notifies subscribers on every state transition", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    const listener = vi.fn();
    window_.subscribe(listener);

    test.resolveNextLoad({ photos: [photo("a")] });
    await flush();

    expect(listener).toHaveBeenCalled();
  });

  it("returns a stable snapshot reference between calls when nothing changed", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.resolveNextLoad({ photos: [photo("a")] });
    await flush();

    expect(window_.getSnapshot()).toBe(window_.getSnapshot());
  });

  it("aborts the in-flight load on dispose and ignores its settlement", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    const snapshotBeforeDispose = window_.getSnapshot();

    expect(() => window_?.dispose()).not.toThrow();
    await flush();

    // Nothing should have thrown, and disposal is idempotent.
    expect(() => window_?.dispose()).not.toThrow();
    expect(snapshotBeforeDispose.isLoadingInitial).toBe(true);
  });

  it("records a restoration anchor without disturbing loaded layout", async () => {
    window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.resolveNextLoad({ photos: [photo("a")] });
    await flush();

    window_.intents.recordRestorationAnchor({ kind: "photo", photoId: "a", rowOffset: 42 });
    expect(window_.getSnapshot().restorationAnchor).toEqual({ kind: "photo", photoId: "a", rowOffset: 42 });
  });

  describe("getSequencePosition", () => {
    it("returns the loaded index without a total while the window can still grow older", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a"), photo("b")], nextCursor: "cursor-1" });
      await flush();

      expect(window_.getSequencePosition("a")).toEqual({ index: 0 });
      expect(window_.getSequencePosition("b")).toEqual({ index: 1 });
    });

    it("includes total once the collection is exhausted", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a"), photo("b")] });
      await flush();

      expect(window_.getSequencePosition("a")).toEqual({ index: 0, total: 2 });
    });

    it("returns undefined for a Photo id that hasn't loaded", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [] });
      await flush();

      expect(window_.getSequencePosition("missing")).toBeUndefined();
    });
  });

  describe("requestThumbnailAccess", () => {
    it("renews only ids nearing expiry, batched, and updates their sources", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a"), photo("b")], expiresAt: new Date(Date.now() + 30_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a", "b"]);
      expect(test.renewalCalls.map(({ photoIds }) => photoIds)).toEqual([["a", "b"]]);

      test.resolveNextRenewal({
        photos: [
          {
            photoId: "a",
            timelineThumbnailSources: {
              large: { url: "https://example.invalid/a-renewed.jpg", dimensions: { width: 640, height: 320 } },
            },
          },
        ],
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      await flush();

      expect(window_.getSnapshot().descriptorsById.get("a")?.timelineThumbnailSources.large.url).toBe(
        "https://example.invalid/a-renewed.jpg",
      );
    });

    it("skips ids whose lease is not yet near expiry", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(Date.now() + 600_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      expect(test.renewalCalls).toEqual([]);
    });

    it("ignores unknown Photo ids", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [] });
      await flush();

      window_.intents.requestThumbnailAccess(["missing"]);
      expect(test.renewalCalls).toEqual([]);
    });

    it("silently skips further demand calls after a failure, within a bounded backoff window", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(Date.now() + 30_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      test.rejectNextRenewal(new Error("boom"));
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      expect(test.renewalCalls).toHaveLength(1);
    });

    it("a force call bypasses the backoff window (online/visibility/retry-window resume)", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(Date.now() + 30_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      test.rejectNextRenewal(new Error("boom"));
      await flush();

      window_.intents.requestThumbnailAccess(["a"], { force: true });
      expect(test.renewalCalls).toHaveLength(2);
    });

    it("a successful renewal clears the backoff window so the next plain demand call isn't skipped", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(Date.now() + 30_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      test.rejectNextRenewal(new Error("boom"));
      await flush();

      // Forced past the backoff window; still near-expiry so it's issued and stays due for the next call too.
      window_.intents.requestThumbnailAccess(["a"], { force: true });
      test.resolveNextRenewal({
        photos: [{ photoId: "a", timelineThumbnailSources: photo("a").timelineThumbnailSources }],
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      expect(test.renewalCalls).toHaveLength(3);
    });

    it("leaves the recovery loop entirely on a 401, instead of backing off and retrying", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(Date.now() + 30_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      test.rejectNextRenewal(new AlbumTransportError("auth_lost", "Session expired"));
      await flush();

      window_.intents.requestThumbnailAccess(["a"], { force: true });
      expect(test.renewalCalls).toHaveLength(1);
    });

    it("aborts an in-flight renewal request on dispose", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(Date.now() + 30_000).toISOString() });
      await flush();

      window_.intents.requestThumbnailAccess(["a"]);
      const { signal } = test.renewalCalls[0]!;
      expect(signal.aborted).toBe(false);

      window_.dispose();
      expect(signal.aborted).toBe(true);
    });
  });

  describe("setWithheld", () => {
    it("marks a descriptor withheld without removing it from layout, so no row's shape or geometry changes; reversal restores the identical index", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a"), photo("b"), photo("c")], expiresAt: "2030-01-01T00:00:00.000Z" });
      await flush();
      const rowsBefore = window_.getSnapshot().layoutItems.filter((item) => item.kind === "row");

      window_.intents.setWithheld("b", true);
      const withheldSnapshot = window_.getSnapshot();
      expect(withheldSnapshot.descriptorsById.has("b")).toBe(true);
      expect(withheldSnapshot.withheldPhotoIds.has("b")).toBe(true);
      const withheldRows = withheldSnapshot.layoutItems.filter((item) => item.kind === "row");
      // Same photo ids, same widths/height as before withholding -- only rendering skips "b".
      expect(withheldRows).toEqual(rowsBefore);
      expect(window_.getSequencePosition("b")).toEqual({ index: 1, total: 3 });

      window_.intents.setWithheld("b", false);
      const restoredSnapshot = window_.getSnapshot();
      expect(restoredSnapshot.withheldPhotoIds.has("b")).toBe(false);
      const restoredRows = restoredSnapshot.layoutItems.filter((item) => item.kind === "row");
      expect(restoredRows).toEqual(rowsBefore);
      expect(window_.getSequencePosition("b")).toEqual({ index: 1, total: 3 });
    });

    it("is a no-op for an unknown Photo id and for a redundant call", async () => {
      window_ = createBrowsingWindow({ collection: "active", port: test.port, layout });
      test.resolveNextLoad({ photos: [photo("a")], expiresAt: "2030-01-01T00:00:00.000Z" });
      await flush();

      const listener = vi.fn();
      window_.subscribe(listener);

      window_.intents.setWithheld("missing", true);
      expect(listener).not.toHaveBeenCalled();

      window_.intents.setWithheld("a", true);
      expect(listener).toHaveBeenCalledTimes(1);
      window_.intents.setWithheld("a", true);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
