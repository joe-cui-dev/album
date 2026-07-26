import { describe, expect, it, vi } from "vitest";
import type { TimelinePhoto } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import { createBrowsingWindow, type BrowsingWindow, type ViewportObservation } from "./browsingWindow.js";
import { createTestAlbumBrowsingPort, type TestAlbumBrowsingPort } from "./testAlbumBrowsingPort.js";
import { createTestBrowsingEnvironment, type TestBrowsingEnvironment } from "./testBrowsingEnvironment.js";

const layout = { containerWidth: 1000, spacing: 10, targetRowHeight: 200 };

const photo = (photoId: string, overrides: Partial<TimelinePhoto> = {}): TimelinePhoto => ({
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

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

interface Rig {
  window_: BrowsingWindow;
  port: TestAlbumBrowsingPort;
  env: TestBrowsingEnvironment;
}

const createRig = (overrides: Partial<Parameters<typeof createBrowsingWindow>[0]> = {}): Rig => {
  const port = createTestAlbumBrowsingPort();
  const env = createTestBrowsingEnvironment();
  const window_ = createBrowsingWindow({
    collection: "active",
    port: port.port,
    layout,
    environment: env.environment,
    nonDemandLeaseLimit: 100,
    ...overrides,
  });
  return { window_, port, env };
};

const observe = (window_: BrowsingWindow, overrides: Partial<ViewportObservation> = {}): void => {
  window_.intents.observeViewport({ containerWidth: layout.containerWidth, scrollOrigin: "initial", ...overrides });
};

describe("createBrowsingWindow", () => {
  describe("construction and activation", () => {
    it("starts no network request at construction", () => {
      const { port } = createRig();
      expect(port.loadCalls).toEqual([]);
    });

    it("starts no network request from activate() alone -- it waits for a viewport observation", () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      expect(port.loadCalls).toEqual([]);
      expect(window_.getSnapshot().state).toBe("loading");
    });

    it("a viewport observation on an active window triggers the initial page load", () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      expect(port.loadCalls).toEqual([{ collection: "active", signal: expect.any(AbortSignal) }]);
    });

    it("passes startAt only for the very first request", async () => {
      const { window_, port } = createRig({ startAt: "2024-06" });
      window_.lifecycle.activate();
      observe(window_);
      expect(port.loadCalls[0]).toMatchObject({ startAt: "2024-06" });

      port.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      expect(port.loadCalls[1]).not.toHaveProperty("startAt");
      expect(port.loadCalls[1]).toMatchObject({ cursor: "cursor-1" });
    });

    it("seeds from an already-fetched initialPage instead of issuing a redundant load (ADR-0058)", () => {
      const { window_, port } = createRig({
        startAt: "2024-06",
        initialPage: { photos: [photo("a"), photo("b")], expiresAt: "2030-01-01T00:00:00.000Z" },
      });
      window_.lifecycle.activate();
      observe(window_);

      expect(port.loadCalls).toEqual([]);
      const snapshot = window_.getSnapshot();
      expect(snapshot.state).toBe("ready");
      expect(snapshot.isExhausted).toBe(true);
    });
  });

  describe("page ingestion and paging", () => {
    it("applies the first page into render-ready rows, newest first", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a"), photo("b")], expiresAt: "2030-01-01T00:00:00.000Z" });
      await flush();

      const snapshot = window_.getSnapshot();
      expect(snapshot.state).toBe("ready");
      expect(snapshot.isExhausted).toBe(true);
      const rows = snapshot.layoutItems.filter((item) => item.kind === "row");
      expect(rows[0]?.cells.map((cell) => cell.photoId)).toEqual(["a", "b"]);
    });

    it("ignores a duplicate Photo id from a later page (first-seen wins)", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
      await flush();

      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a"), photo("b")] });
      await flush();

      const rows = window_.getSnapshot().layoutItems.filter((item) => item.kind === "row");
      expect(rows.flatMap((row) => row.cells.map((cell) => cell.photoId))).toEqual(["a", "b"]);
    });

    it("is single-flight: repeated demand while a load is in flight issues no second request", () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 5 } });
      expect(port.loadCalls).toHaveLength(1);
    });

    it("keeps paging until the soon-visible target is covered, then stops at exhaustion", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 20 } });
      // A tiny first page can't cover 20 rows of soon-visible demand -- expect automatic continuation.
      port.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
      await flush();
      expect(port.loadCalls.length).toBeGreaterThan(1);

      port.resolveNextLoad({ photos: [photo("b")] });
      await flush();
      expect(window_.getSnapshot().isExhausted).toBe(true);
      const callCountAtExhaustion = port.loadCalls.length;

      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 20 } });
      expect(port.loadCalls).toHaveLength(callCountAtExhaustion);
    });

    it("projects an initial-failure with no rows, and a tail-failure once rows exist", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.rejectNextLoad(new AlbumTransportError("network", "boom"));
      await flush();
      expect(window_.getSnapshot().state).toBe("initial-failure");

      window_.intents.retry();
      port.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.rejectNextLoad(new AlbumTransportError("network", "boom"));
      await flush();

      expect(window_.getSnapshot().state).toBe("tail-failure");
      expect(window_.getSnapshot().layoutItems.some((item) => item.kind === "row")).toBe(true);
    });

    it("retry clears the failure and resumes from the retained cursor", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.rejectNextLoad(new AlbumTransportError("network", "boom"));
      await flush();

      window_.intents.retry();
      expect(port.loadCalls).toHaveLength(2);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();

      expect(window_.getSnapshot().state).toBe("ready");
    });

    it("retry is a no-op without a genuine failure", () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      window_.intents.retry();
      expect(port.loadCalls).toHaveLength(1);
    });
  });

  describe("render projection and structural sharing", () => {
    it("returns a stable snapshot reference between calls when nothing changed", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();

      expect(window_.getSnapshot()).toBe(window_.getSnapshot());
    });

    it("replaces only the affected row when one Photo's access changes; unaffected rows keep identity", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      // Two photos, each alone (tiny aspect ratio impossible here, so force two periods -> two rows).
      port.resolveNextLoad({
        photos: [photo("a", { capturedAt: { precision: "day", localDate: "2024-06-15" } }), photo("b", { capturedAt: { precision: "day", localDate: "2024-05-15" } })],
      });
      await flush();

      const before = window_.getSnapshot().layoutItems.filter((item) => item.kind === "row");
      expect(before).toHaveLength(2);

      window_.lifecycle.setWithheld("a", true);
      const after = window_.getSnapshot().layoutItems.filter((item) => item.kind === "row");
      const rowA = after.find((row) => row.cells.some((cell) => cell.photoId === "a"))!;
      const rowB = after.find((row) => row.cells.some((cell) => cell.photoId === "b"))!;
      expect(rowA).not.toBe(before.find((row) => row.cells.some((cell) => cell.photoId === "a")));
      expect(rowB).toBe(before.find((row) => row.cells.some((cell) => cell.photoId === "b")));
    });
  });

  describe("withholding (ADR-0067)", () => {
    it("marks a cell withheld without moving it or changing row geometry; reversal restores it", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a"), photo("b"), photo("c")], expiresAt: "2030-01-01T00:00:00.000Z" });
      await flush();

      const rowsBefore = window_.getSnapshot().layoutItems.filter((item) => item.kind === "row");

      window_.lifecycle.setWithheld("b", true);
      const withheldRows = window_.getSnapshot().layoutItems.filter((item) => item.kind === "row");
      expect(withheldRows.map((row) => row.cells.map((cell) => cell.photoId))).toEqual(rowsBefore.map((row) => row.cells.map((cell) => cell.photoId)));
      const withheldCell = withheldRows[0]!.cells.find((cell) => cell.photoId === "b")!;
      expect(withheldCell.presentation).toEqual({ kind: "withheld" });

      window_.lifecycle.setWithheld("b", false);
      const restoredCell = window_
        .getSnapshot()
        .layoutItems.filter((item) => item.kind === "row")[0]!
        .cells.find((cell) => cell.photoId === "b")!;
      expect(restoredCell.presentation.kind).not.toBe("withheld");
    });

    it("is a no-op for an unknown Photo id and for a redundant call", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();

      const listener = vi.fn();
      window_.subscribe(listener);

      window_.lifecycle.setWithheld("missing", true);
      expect(listener).not.toHaveBeenCalled();

      window_.lifecycle.setWithheld("a", true);
      expect(listener).toHaveBeenCalledTimes(1);
      window_.lifecycle.setWithheld("a", true);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("lease acquisition, batching, and the one-shot renewal scheduler", () => {
    it("batches thumbnail access acquisition for demanded Photos and never exceeds 100 per batch", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      const manyPhotos = Array.from({ length: 40 }, (_, index) => photo(`p${index}`, { capturedAt: { precision: "day", localDate: "2024-06-15" } }));
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 200 } });
      port.resolveNextLoad({ photos: manyPhotos });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 200 } });

      expect(port.renewalCalls).toHaveLength(1);
      expect(port.renewalCalls[0]!.photoIds.length).toBeLessThanOrEqual(100);
    });

    it("schedules exactly one next deadline for renewal, never an interval", async () => {
      const { window_, port, env } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(120_000).toISOString() });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextRenewal({
        photos: [{ photoId: "a", timelineThumbnailSources: photo("a").timelineThumbnailSources }],
        expiresAt: new Date(120_000).toISOString(),
      });
      await flush();

      expect(env.pendingTimerCount()).toBeLessThanOrEqual(1);
    });

    it("renews a lease once its scheduled deadline fires", async () => {
      const { window_, port, env } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(120_000).toISOString() });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      expect(port.renewalCalls).toHaveLength(0); // not yet within the 60s lead

      env.advanceTo(120_000 - 60_000);
      expect(port.renewalCalls).toHaveLength(1);
    });

    it("backs off after a renewal failure and resumes once the backoff elapses", async () => {
      const { window_, port, env } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(30_000).toISOString() });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      expect(port.renewalCalls).toHaveLength(1);

      port.rejectNextRenewal(new Error("boom"));
      await flush();
      // Immediately re-evaluating demand must not retry within the backoff window.
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      expect(port.renewalCalls).toHaveLength(1);

      env.advanceBy(5_000);
      expect(port.renewalCalls).toHaveLength(2);
    });

    it("evicts the least-recently-used non-demand lease once the count bound is exceeded", async () => {
      const { window_, port } = createRig({ nonDemandLeaseLimit: 0 });
      window_.lifecycle.activate();
      // A wide initial range so both Photos' leases are ingested as demand -- nothing evicted yet.
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 10 } });
      port.resolveNextLoad({
        photos: [
          photo("a", { capturedAt: { precision: "day", localDate: "2024-06-15" } }),
          photo("b", { capturedAt: { precision: "day", localDate: "2024-05-15" } }),
        ],
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
      await flush();
      expect(cellFor(window_, "a").presentation.kind).toBe("ready");
      expect(cellFor(window_, "b").presentation.kind).toBe("ready");

      // Narrowing demand to "a"'s row alone (item 1, with no soon-visible margin) drops "b" out of
      // demand -- with a 1-slot non-demand bound, its lease is evicted immediately.
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 1 }, viewportExtent: 0 });

      expect(cellFor(window_, "a").presentation.kind).toBe("ready");
      expect(cellFor(window_, "b").presentation.kind).toBe("loading");
    });
  });

  describe("lease-revisioned thumbnail outcome recovery", () => {
    it("ignores a stale outcome from an older lease revision", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(120_000).toISOString() });
      await flush();

      window_.intents.reportThumbnailOutcome({ photoId: "a", leaseRevision: 999, outcome: "failed" });
      expect(port.renewalCalls).toHaveLength(0);
    });

    it("forces one renewal on first failure, then a placeholder if the renewed revision also fails", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(120_000).toISOString() });
      await flush();
      const firstRevision = leaseRevisionOf(window_, "a");

      window_.intents.reportThumbnailOutcome({ photoId: "a", leaseRevision: firstRevision, outcome: "failed" });
      expect(port.renewalCalls).toHaveLength(1);
      port.resolveNextRenewal({
        photos: [{ photoId: "a", timelineThumbnailSources: photo("a").timelineThumbnailSources }],
        expiresAt: new Date(180_000).toISOString(),
      });
      await flush();
      const secondRevision = leaseRevisionOf(window_, "a");
      expect(secondRevision).not.toBe(firstRevision);

      window_.intents.reportThumbnailOutcome({ photoId: "a", leaseRevision: secondRevision, outcome: "failed" });
      const cell = cellFor(window_, "a");
      expect(cell.presentation).toEqual({ kind: "placeholder" });
      // No second forced renewal for this cycle.
      expect(port.renewalCalls).toHaveLength(1);
    });

    it("a successful load clears prior failure/placeholder state", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(120_000).toISOString() });
      await flush();
      const revision = leaseRevisionOf(window_, "a");

      window_.intents.reportThumbnailOutcome({ photoId: "a", leaseRevision: revision, outcome: "loaded" });
      const cell = cellFor(window_, "a");
      expect(cell.presentation.kind).toBe("ready");
    });
  });

  describe("offline and hidden suspension", () => {
    it("suspends new page loads while offline and resumes automatically once online", async () => {
      const { window_, port, env } = createRig();
      env.setOnline(false);
      window_.lifecycle.activate();
      observe(window_);
      expect(port.loadCalls).toHaveLength(0);
      expect(window_.getSnapshot().state).toBe("loading");
      expect(window_.getSnapshot().offline).toBe(true);

      env.setOnline(true);
      expect(port.loadCalls).toHaveLength(1);
    });

    it("suspends new page loads while hidden and resumes on visible", async () => {
      const { window_, port, env } = createRig();
      env.setVisible(false);
      window_.lifecycle.activate();
      observe(window_);
      expect(port.loadCalls).toHaveLength(0);

      env.setVisible(true);
      expect(port.loadCalls).toHaveLength(1);
    });

    it("admits an in-flight settlement while hidden rather than treating it as a failure", async () => {
      const { window_, port, env } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      env.setVisible(false);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();

      expect(window_.getSnapshot().state).toBe("ready");
    });

    it("a collection request rejected across an offline transition is suspension, not a failure", async () => {
      const { window_, port, env } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      env.setOnline(false);
      port.rejectNextLoad(new Error("network down"));
      await flush();

      expect(window_.getSnapshot().state).toBe("loading");
      expect(window_.getSnapshot().offline).toBe(true);

      env.setOnline(true);
      expect(port.loadCalls).toHaveLength(2);
    });

    it("a renewal rejected across an offline transition doesn't trigger backoff or consume a recovery attempt", async () => {
      const { window_, port, env } = createRig();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      port.resolveNextLoad({ photos: [photo("a")], expiresAt: new Date(30_000).toISOString() });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      expect(port.renewalCalls).toHaveLength(1);

      env.setOnline(false);
      port.rejectNextRenewal(new Error("network down"));
      await flush();

      env.setOnline(true);
      expect(port.renewalCalls).toHaveLength(2);
    });
  });

  describe("lifecycle generation races", () => {
    it("deactivate aborts the in-flight load and a late settlement is ignored", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      const signal = port.loadCalls[0]!.signal;

      window_.lifecycle.deactivate();
      expect(signal.aborted).toBe(true);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();

      expect(window_.getSnapshot().state).toBe("loading");
    });

    it("a settlement that outraces abort from a now-stale generation is still ignored", async () => {
      const testPort = createTestAlbumBrowsingPort({ rejectOnAbort: false });
      const { window_ } = createRig({ port: testPort.port });
      window_.lifecycle.activate();
      observe(window_);

      window_.lifecycle.deactivate();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      // The stale (pre-deactivate) request now settles even though it was aborted.
      testPort.resolveLoad(0, { photos: [photo("stale")] });
      await flush();

      expect(cellExists(window_, "stale")).toBe(false);
    });

    it("reactivation resumes demand-driven paging from the retained cursor without a duplicate initial request", async () => {
      const { window_, port } = createRig();
      // Wide enough that one Photo alone already closes its row, independent of the tail/hasMore state.
      const wide = (id: string): TimelinePhoto => photo(id, { displayDimensions: { width: 2000, height: 100 } });
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 1 } });
      port.resolveNextLoad({ photos: [wide("a")], nextCursor: "cursor-1" });
      await flush();
      expect(port.loadCalls[0]).not.toHaveProperty("cursor");
      expect(port.loadCalls).toHaveLength(1); // the loaded row already covers this viewport -- no further page needed yet

      window_.lifecycle.deactivate();
      window_.lifecycle.activate();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 20 } });

      expect(port.loadCalls).toHaveLength(2);
      expect(port.loadCalls[1]).toMatchObject({ cursor: "cursor-1" });
      expect(port.loadCalls[1]).not.toHaveProperty("startAt");
    });

    it("dispose aborts everything and is idempotent", () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      const signal = port.loadCalls[0]!.signal;

      expect(() => window_.lifecycle.dispose()).not.toThrow();
      expect(signal.aborted).toBe(true);
      expect(() => window_.lifecycle.dispose()).not.toThrow();
    });
  });

  describe("resize, reflow, and restoration handshake", () => {
    it("ignores a repeated observation of the same effective width", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });

      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      expect(window_.getSnapshot().restorationDirective).toBeUndefined();
    });

    it("a meaningful width change issues a restoration directive with the preserved row offset", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();
      // Item 0 is the month marker, item 1 is "a"'s row.
      observe(window_, { visibleItemRange: { startIndex: 1, endIndex: 1 }, visibleItemTopOffset: 40 });

      observe(window_, { containerWidth: 500, scrollOrigin: "programmatic" });

      const directive = window_.getSnapshot().restorationDirective;
      expect(directive).toMatchObject({ kind: "photo", photoId: "a", rowOffset: 40 });
    });

    it("an ordinary observation cannot acknowledge restoration; a matching applied revision completes it", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      observe(window_, { containerWidth: 500, scrollOrigin: "programmatic" });
      const revision = window_.getSnapshot().restorationDirective!.revision;

      observe(window_, { containerWidth: 500, visibleItemRange: { startIndex: 0, endIndex: 0 }, scrollOrigin: "programmatic" });
      expect(window_.getSnapshot().restorationDirective).toBeDefined();

      observe(window_, {
        containerWidth: 500,
        visibleItemRange: { startIndex: 0, endIndex: 0 },
        scrollOrigin: "programmatic",
        appliedRestorationRevision: revision,
      });
      expect(window_.getSnapshot().restorationDirective).toBeUndefined();
    });

    it("a User-initiated scroll cancels a pending restoration", async () => {
      const { window_, port } = createRig();
      window_.lifecycle.activate();
      observe(window_);
      port.resolveNextLoad({ photos: [photo("a")] });
      await flush();
      observe(window_, { visibleItemRange: { startIndex: 0, endIndex: 0 } });
      observe(window_, { containerWidth: 500, scrollOrigin: "programmatic" });
      expect(window_.getSnapshot().restorationDirective).toBeDefined();

      observe(window_, { containerWidth: 500, visibleItemRange: { startIndex: 0, endIndex: 0 }, scrollOrigin: "user" });
      expect(window_.getSnapshot().restorationDirective).toBeUndefined();
    });
  });
});

const leaseRevisionOf = (window_: BrowsingWindow, photoId: string): number => {
  const cell = cellFor(window_, photoId);
  if (cell.presentation.kind !== "ready") {
    throw new Error(`expected "${photoId}" to be ready`);
  }
  return cell.presentation.leaseRevision;
};

const cellFor = (window_: BrowsingWindow, photoId: string) => {
  const cell = window_
    .getSnapshot()
    .layoutItems.filter((item) => item.kind === "row")
    .flatMap((row) => row.cells)
    .find((candidate) => candidate.photoId === photoId);
  if (!cell) {
    throw new Error(`no cell for "${photoId}"`);
  }
  return cell;
};

const cellExists = (window_: BrowsingWindow, photoId: string): boolean =>
  window_
    .getSnapshot()
    .layoutItems.filter((item) => item.kind === "row")
    .flatMap((row) => row.cells)
    .some((candidate) => candidate.photoId === photoId);
