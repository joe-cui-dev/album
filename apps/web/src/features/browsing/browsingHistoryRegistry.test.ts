import { describe, expect, it, vi } from "vitest";
import { createBrowsingHistoryRegistry } from "./browsingHistoryRegistry.js";
import type { BrowsingWindow } from "./browsingWindow.js";

const fakeWindow = (): BrowsingWindow => ({
  getSnapshot: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  intents: {
    observeViewport: vi.fn(),
    reportThumbnailOutcome: vi.fn(),
    retry: vi.fn(),
  },
  lifecycle: {
    activate: vi.fn(),
    deactivate: vi.fn(),
    dispose: vi.fn(),
    setWithheld: vi.fn(),
  },
});

describe("createBrowsingHistoryRegistry", () => {
  it("creates and activates a window on first activation, and reuses it for the same key", () => {
    const registry = createBrowsingHistoryRegistry();
    const create = vi.fn(fakeWindow);

    const first = registry.activate("key-1", "active", create);
    const second = registry.activate("key-1", "active", create);

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    expect(first.lifecycle.activate).toHaveBeenCalledTimes(1);
  });

  it("retains the previously active window as the inactive slot, deactivated but not disposed", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();

    registry.activate("timeline", "active", () => timeline);
    registry.activate("archive", "archived", () => archive);

    expect(timeline.lifecycle.deactivate).toHaveBeenCalledTimes(1);
    expect(timeline.lifecycle.dispose).not.toHaveBeenCalled();
    // Reactivating "timeline" should reuse the retained instance, not create a new one.
    const create = vi.fn(fakeWindow);
    expect(registry.activate("timeline", "active", create)).toBe(timeline);
    expect(create).not.toHaveBeenCalled();
  });

  it("drives the exact active/inactive lifecycle order across activate -> inactive -> reactivate", () => {
    const registry = createBrowsingHistoryRegistry();
    const a = fakeWindow();
    const b = fakeWindow();

    registry.activate("a", "active", () => a);
    registry.activate("b", "archived", () => b);
    registry.activate("a", "active", () => a);

    expect(a.lifecycle.activate).toHaveBeenNthCalledWith(1);
    expect(a.lifecycle.deactivate).toHaveBeenCalledTimes(1);
    expect(b.lifecycle.activate).toHaveBeenCalledTimes(1);
    expect(a.lifecycle.activate).toHaveBeenCalledTimes(2);
    expect(b.lifecycle.deactivate).toHaveBeenCalledTimes(1);
  });

  it("disposes the evicted window once a third distinct key is activated", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    const jump = fakeWindow();

    registry.activate("timeline", "active", () => timeline);
    registry.activate("archive", "archived", () => archive);
    registry.activate("jump:2024-06", "active", () => jump);

    expect(timeline.lifecycle.dispose).toHaveBeenCalledTimes(1);
    expect(archive.lifecycle.dispose).not.toHaveBeenCalled();
  });

  it("disposeAll disposes both retained windows and forgets them", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    registry.activate("timeline", "active", () => timeline);
    registry.activate("archive", "archived", () => archive);

    registry.disposeAll();

    expect(timeline.lifecycle.dispose).toHaveBeenCalledTimes(1);
    expect(archive.lifecycle.dispose).toHaveBeenCalledTimes(1);

    const recreated = fakeWindow();
    const create = vi.fn(() => recreated);
    expect(registry.activate("timeline", "active", create)).toBe(recreated);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("applyMembershipChange", () => {
  it("withholds the Photo in the mounted window whose collection it left", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    registry.activate("key-1", "active", () => timeline);

    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    expect(timeline.lifecycle.setWithheld).toHaveBeenCalledWith("photo-1", true);
  });

  it("invalidates a retained-inactive slot for a collection that isn't mounted", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    registry.activate("archive-key", "archived", () => archive);
    registry.activate("active-key", "active", () => timeline);

    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    // "archived" (the arrival collection) is retained-inactive and not mounted: invalidated.
    expect(archive.lifecycle.dispose).toHaveBeenCalledTimes(1);
    const recreatedArchive = fakeWindow();
    const create = vi.fn(() => recreatedArchive);
    expect(registry.activate("archive-key-2", "archived", create)).toBe(recreatedArchive);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not withhold in a mounted window whose collection is only the arrival side", () => {
    const registry = createBrowsingHistoryRegistry();
    const archive = fakeWindow();
    registry.activate("archive-key", "archived", () => archive);

    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    expect(archive.lifecycle.setWithheld).not.toHaveBeenCalled();
    expect(archive.lifecycle.dispose).not.toHaveBeenCalled();
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
    registry.activate("active-key", "active", () => timeline);
    registry.applyMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    registry.revertMembershipChange({ photoId: "photo-1", leftCollection: "active" });

    expect(timeline.lifecycle.setWithheld).toHaveBeenNthCalledWith(2, "photo-1", false);
  });

  it("is a no-op when that collection isn't mounted", () => {
    const registry = createBrowsingHistoryRegistry();
    const archive = fakeWindow();
    registry.activate("archive-key", "archived", () => archive);

    expect(() =>
      registry.revertMembershipChange({ photoId: "photo-1", leftCollection: "active" }),
    ).not.toThrow();
    expect(archive.lifecycle.setWithheld).not.toHaveBeenCalled();
  });
});

describe("notifyPhotosArrived", () => {
  it("leaves a mounted Timeline alone (no reflow or jump)", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    registry.activate("active-key", "active", () => timeline);

    registry.notifyPhotosArrived();

    expect(timeline.lifecycle.setWithheld).not.toHaveBeenCalled();
    expect(timeline.lifecycle.dispose).not.toHaveBeenCalled();
  });

  it("invalidates a retained-inactive Timeline slot so the next activation refetches", () => {
    const registry = createBrowsingHistoryRegistry();
    const archive = fakeWindow();
    const timeline = fakeWindow();
    registry.activate("active-key", "active", () => timeline);
    registry.activate("archive-key", "archived", () => archive);

    registry.notifyPhotosArrived();

    expect(timeline.lifecycle.dispose).toHaveBeenCalledTimes(1);
    const recreatedTimeline = fakeWindow();
    const create = vi.fn(() => recreatedTimeline);
    expect(registry.activate("active-key-2", "active", create)).toBe(recreatedTimeline);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is a no-op with no mounted or retained Timeline windows", () => {
    const registry = createBrowsingHistoryRegistry();
    expect(() => registry.notifyPhotosArrived()).not.toThrow();
  });
});

describe("applyChronologyChange", () => {
  it("withholds the stale mounted placement without a live jump", () => {
    const registry = createBrowsingHistoryRegistry();
    const archive = fakeWindow();
    const timeline = fakeWindow();
    registry.activate("archive-key", "archived", () => archive);
    registry.activate("active-key", "active", () => timeline);

    registry.applyChronologyChange({ photoId: "photo-1", collection: "active" });

    expect(timeline.lifecycle.setWithheld).toHaveBeenCalledWith("photo-1", true);
    expect(archive.lifecycle.dispose).not.toHaveBeenCalled();
  });

  it("invalidates a retained window for the changed collection", () => {
    const registry = createBrowsingHistoryRegistry();
    const timeline = fakeWindow();
    const archive = fakeWindow();
    registry.activate("active-key", "active", () => timeline);
    registry.activate("archive-key", "archived", () => archive);

    registry.applyChronologyChange({ photoId: "photo-1", collection: "active" });

    expect(timeline.lifecycle.dispose).toHaveBeenCalledTimes(1);
  });
});
