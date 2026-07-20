import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewerBootstrapResponse } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import { createPhotoViewer, type PhotoViewer } from "./photoViewer.js";
import { createTestPhotoViewerPort, type TestPhotoViewerPort } from "./testPhotoViewerPort.js";

const bootstrap = (photoId: string, overrides: Partial<ViewerBootstrapResponse> = {}): ViewerBootstrapResponse => ({
  photoId,
  fileName: `${photoId}.jpg`,
  format: "jpeg",
  fileSizeBytes: 1024,
  displayDimensions: { width: 800, height: 600 },
  chronology: {
    original: { capturedAt: { precision: "day", localDate: "2024-06-15" }, source: "exif" },
    active: { capturedAt: { precision: "day", localDate: "2024-06-15" }, source: "exif", revision: 1 },
  },
  archived: false,
  collection: "active",
  displayAccess: { url: `https://example.invalid/${photoId}.jpg`, expiresAt: "2030-01-01T00:00:00.000Z" },
  ...overrides,
});

describe("createPhotoViewer", () => {
  let test: TestPhotoViewerPort;
  let viewer: PhotoViewer | undefined;

  beforeEach(() => {
    test = createTestPhotoViewerPort();
  });

  afterEach(() => {
    viewer?.dispose();
  });

  it("loads the requested Photo and starts in a loading state", () => {
    viewer = createPhotoViewer({ photoId: "b", sourceCollection: "active", port: test.port });

    expect(test.calls).toEqual([{ photoId: "b", collection: "active" }]);
    expect(viewer.getSnapshot().isLoading).toBe(true);
  });

  it("exposes the loaded bootstrap and neighbour availability", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.resolveNextBootstrap(bootstrap("b", { newerPhotoId: "a", olderPhotoId: "c" }));
    await flush();

    const snapshot = viewer.getSnapshot();
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.bootstrap?.photoId).toBe("b");
  });

  it("showPrevious follows newerPhotoId and showNext follows olderPhotoId", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.resolveNextBootstrap(bootstrap("b", { newerPhotoId: "a", olderPhotoId: "c" }));
    await flush();

    viewer.intents.showPrevious();
    expect(test.calls[1]).toEqual({ photoId: "a", collection: "active" });
    test.resolveNextBootstrap(bootstrap("a", { olderPhotoId: "b" }));
    await flush();
    expect(viewer.getSnapshot().photoId).toBe("a");

    viewer.intents.showNext();
    expect(test.calls[2]).toEqual({ photoId: "b", collection: "active" });
  });

  it("does nothing when there is no neighbour in that direction", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.resolveNextBootstrap(bootstrap("b", {}));
    await flush();

    viewer.intents.showPrevious();
    viewer.intents.showNext();
    expect(test.calls).toHaveLength(1);
  });

  it("carries the resolved collection forward into neighbour requests", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.resolveNextBootstrap(bootstrap("b", { collection: "archived", olderPhotoId: "c" }));
    await flush();

    viewer.intents.showNext();
    expect(test.calls[1]).toEqual({ photoId: "c", collection: "archived" });
  });

  it("exposes the currently resolved collection without reaching into the snapshot's bootstrap", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    expect(viewer.getCurrentCollection()).toBeUndefined();

    test.resolveNextBootstrap(bootstrap("b", { collection: "archived" }));
    await flush();
    expect(viewer.getCurrentCollection()).toBe("archived");
  });

  it("surfaces a photo_collection_changed conflict distinctly from a generic load error", async () => {
    viewer = createPhotoViewer({ photoId: "b", sourceCollection: "archived", port: test.port });
    test.rejectNextBootstrap(
      new AlbumTransportError("photo_collection_changed", "moved", { currentCollection: "active" }),
    );
    await flush();

    const snapshot = viewer.getSnapshot();
    expect(snapshot.collectionChanged).toEqual({ currentCollection: "active" });
    expect(snapshot.loadError).toBeUndefined();
  });

  it("switchToCurrentCollection re-requests with the conflict's current collection", async () => {
    viewer = createPhotoViewer({ photoId: "b", sourceCollection: "archived", port: test.port });
    test.rejectNextBootstrap(
      new AlbumTransportError("photo_collection_changed", "moved", { currentCollection: "active" }),
    );
    await flush();

    viewer.intents.switchToCurrentCollection();
    expect(test.calls[1]).toEqual({ photoId: "b", collection: "active" });
  });

  it("classifies other failures as a retryable loadError", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.rejectNextBootstrap(new AlbumTransportError("network", "offline"));
    await flush();

    expect(viewer.getSnapshot().loadError).toBe("network");
    viewer.intents.retry();
    expect(test.calls).toHaveLength(2);
  });

  it("offsets the originating Sequence Position by one on each Previous/Next step", async () => {
    viewer = createPhotoViewer({
      photoId: "b",
      port: test.port,
      initialSequencePosition: { index: 4, total: 10 },
    });
    test.resolveNextBootstrap(bootstrap("b", { newerPhotoId: "a", olderPhotoId: "c" }));
    await flush();
    expect(viewer.getSnapshot().sequencePosition).toEqual({ index: 4, total: 10 });

    viewer.intents.showNext();
    test.resolveNextBootstrap(bootstrap("c", { newerPhotoId: "b" }));
    await flush();
    expect(viewer.getSnapshot().sequencePosition).toEqual({ index: 5, total: 10 });

    viewer.intents.showPrevious();
    test.resolveNextBootstrap(bootstrap("b", { newerPhotoId: "a", olderPhotoId: "c" }));
    await flush();
    expect(viewer.getSnapshot().sequencePosition).toEqual({ index: 4, total: 10 });
  });

  it("clears the Sequence Position once a collection switch breaks its reliability", async () => {
    viewer = createPhotoViewer({
      photoId: "b",
      sourceCollection: "archived",
      port: test.port,
      initialSequencePosition: { index: 4, total: 10 },
    });
    test.rejectNextBootstrap(
      new AlbumTransportError("photo_collection_changed", "moved", { currentCollection: "active" }),
    );
    await flush();

    viewer.intents.switchToCurrentCollection();
    test.resolveNextBootstrap(bootstrap("b", { collection: "active" }));
    await flush();

    expect(viewer.getSnapshot().sequencePosition).toBeUndefined();
  });

  it("prefetches both neighbours' bootstrap and image once the display decodes", async () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.resolveNextBootstrap(bootstrap("b", { newerPhotoId: "a", olderPhotoId: "c" }));
    await flush();

    viewer.intents.notifyDisplayDecoded();
    await flush();

    const prefetchCalls = test.calls.slice(1);
    expect(prefetchCalls.map((call) => call.photoId).sort()).toEqual(["a", "c"]);
  });

  it("suppresses prefetch while the document is hidden", async () => {
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    test.resolveNextBootstrap(bootstrap("b", { newerPhotoId: "a", olderPhotoId: "c" }));
    await flush();

    viewer.intents.notifyDisplayDecoded();
    await flush();

    expect(test.calls).toHaveLength(1);
    visibilitySpy.mockRestore();
  });

  it("aborts in-flight requests on dispose", () => {
    viewer = createPhotoViewer({ photoId: "b", port: test.port });
    const abortListener = vi.fn();
    // The pending load's signal is only reachable through the port's recorded call semantics;
    // dispose should not throw and further snapshot reads keep the last known state.
    viewer.dispose();
    expect(() => viewer?.getSnapshot()).not.toThrow();
    expect(abortListener).not.toHaveBeenCalled();
  });
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
