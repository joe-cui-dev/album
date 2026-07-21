import { describe, expect, it, vi } from "vitest";
import { createBrowsingHistoryRegistry } from "./browsingHistoryRegistry.js";
import type { BrowsingWindow } from "./browsingWindow.js";

const fakeWindow = (): BrowsingWindow => ({
  getSnapshot: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getSequencePosition: vi.fn(() => undefined),
  intents: {
    loadMore: vi.fn(),
    retry: vi.fn(),
    setLayout: vi.fn(),
    recordRestorationAnchor: vi.fn(),
    requestThumbnailAccess: vi.fn(),
    setWithheld: vi.fn(),
  },
  dispose: vi.fn(),
});

describe("createBrowsingHistoryRegistry", () => {
  it("creates a window on first activation and reuses it for the same key", () => {
    const registry = createBrowsingHistoryRegistry();
    const create = vi.fn(fakeWindow);

    const first = registry.activate("timeline", create);
    const second = registry.activate("timeline", create);

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retains the previously active window as the inactive slot without disposing it", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();

    registry.activate("timeline", () => timeline);
    registry.activate("archive", () => archive);

    expect(timeline.dispose).not.toHaveBeenCalled();
    // Reactivating "timeline" should reuse the retained instance, not create a new one.
    const create = vi.fn(fakeWindow);
    expect(registry.activate("timeline", create)).toBe(timeline);
    expect(create).not.toHaveBeenCalled();
  });

  it("disposes the evicted window once a third distinct key is activated", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    const jump = fakeWindow();

    registry.activate("timeline", () => timeline);
    registry.activate("archive", () => archive);
    registry.activate("jump:2024-06", () => jump);

    expect(timeline.dispose).toHaveBeenCalledTimes(1);
    expect(archive.dispose).not.toHaveBeenCalled();
  });

  it("disposeAll disposes both retained windows and forgets them", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    registry.activate("timeline", () => timeline);
    registry.activate("archive", () => archive);

    registry.disposeAll();

    expect(timeline.dispose).toHaveBeenCalledTimes(1);
    expect(archive.dispose).toHaveBeenCalledTimes(1);

    const recreated = fakeWindow();
    const create = vi.fn(() => recreated);
    expect(registry.activate("timeline", create)).toBe(recreated);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("applyMembershipChange", () => {
  it("withholds the Photo in the mounted window whose collection it left", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    registry.activate("active:latest", () => timeline);

    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    expect(timeline.intents.setWithheld).toHaveBeenCalledWith("photo-1", true);
  });

  it("invalidates a retained-inactive slot for a collection that isn't mounted", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    registry.activate("archived:latest", () => archive);
    registry.activate("active:latest", () => timeline);

    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    // "archived" (the arrival collection) is retained-inactive and not mounted: invalidated.
    expect(archive.dispose).toHaveBeenCalledTimes(1);
    const recreatedArchive = fakeWindow();
    const create = vi.fn(() => recreatedArchive);
    expect(registry.activate("archived:latest", create)).toBe(recreatedArchive);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not withhold in a mounted window whose collection is only the arrival side", () => {
    const registry = createBrowsingHistoryRegistry();
    const archive = fakeWindow();
    registry.activate("archived:latest", () => archive);

    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    expect(archive.intents.setWithheld).not.toHaveBeenCalled();
    expect(archive.dispose).not.toHaveBeenCalled();
  });

  it("is a no-op with no mounted or retained windows (direct-route Viewer case)", () => {
    const registry = createBrowsingHistoryRegistry();
    expect(() =>
      registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" }),
    ).not.toThrow();
  });
});

describe("revertMembershipChange", () => {
  it("un-withholds the Photo in the mounted window matching leftCollection", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    registry.activate("active:latest", () => timeline);
    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    registry.revertMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    expect(timeline.intents.setWithheld).toHaveBeenNthCalledWith(2, "photo-1", false);
  });

  it("is a no-op when that collection isn't mounted", () => {
    const registry = createBrowsingHistoryRegistry();
    const archive = fakeWindow();
    registry.activate("archived:latest", () => archive);

    expect(() =>
      registry.revertMembershipChange({ photoId: "photo-1", leftCollection: "active" }),
    ).not.toThrow();
    expect(archive.intents.setWithheld).not.toHaveBeenCalled();
  });
});
