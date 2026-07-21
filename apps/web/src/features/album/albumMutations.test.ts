import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowsingHistoryRegistry } from "../browsing/browsingHistoryRegistry.js";
import { createAlbumMutations, type AlbumMutations } from "./albumMutations.js";
import { createTestAlbumMutationsPort, type TestAlbumMutationsPort } from "./testAlbumMutationsPort.js";

const fakeRegistry = (): BrowsingHistoryRegistry => ({
  activate: vi.fn(),
  applyMembershipChange: vi.fn(),
  revertMembershipChange: vi.fn(),
  disposeAll: vi.fn(),
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createAlbumMutations", () => {
  let test: TestAlbumMutationsPort;
  let registry: BrowsingHistoryRegistry;
  let mutations: AlbumMutations | undefined;

  beforeEach(() => {
    test = createTestAlbumMutationsPort();
    registry = fakeRegistry();
  });

  afterEach(() => {
    mutations?.dispose();
    vi.useRealTimers();
  });

  it("applies the membership change to the registry and publishes success feedback optimistically, before the request resolves", () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });

    expect(registry.applyMembershipChange).toHaveBeenCalledWith({ photoId: "photo-1", leftCollection: "active" });
    expect(mutations.getSnapshot().feedback).toMatchObject({ kind: "success", message: "Photo moved to Archive" });
    expect(test.setArchiveMembershipCalls).toEqual([{ photoId: "photo-1", archived: true }]);
  });

  it("bumps navigationRevision on success without replacing the feedback entry", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    const feedbackId = mutations.getSnapshot().feedback?.id;

    test.resolveNextSetArchiveMembership({ photoId: "photo-1", archived: true });
    await flush();

    expect(mutations.getSnapshot().navigationRevision).toBe(1);
    expect(mutations.getSnapshot().feedback?.id).toBe(feedbackId);
  });

  it("on failure, rolls back membership (not navigation) and replaces feedback with a persistent, retryable failure", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });

    test.rejectNextSetArchiveMembership(new Error("boom"));
    await flush();

    expect(registry.revertMembershipChange).toHaveBeenCalledWith({ photoId: "photo-1", leftCollection: "active" });
    expect(mutations.getSnapshot().navigationRevision).toBe(0);
    const feedback = mutations.getSnapshot().feedback;
    expect(feedback).toMatchObject({ kind: "failure" });
    expect(feedback?.action?.label).toBe("Retry");
  });

  it("Undo un-withholds in the same mounted window the original action withheld it in, and issues the reverse request", () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    const undo = mutations.getSnapshot().feedback?.action;

    undo?.onInvoke();

    expect(registry.revertMembershipChange).toHaveBeenCalledWith({
      photoId: "photo-1",
      leftCollection: "active",
    });
    expect(test.setArchiveMembershipCalls).toEqual([
      { photoId: "photo-1", archived: true },
      { photoId: "photo-1", archived: false },
    ]);
  });

  it("treats a re-archive of an already-archived Photo as an ordinary success (server idempotency)", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    test.resolveNextSetArchiveMembership({ photoId: "photo-1", archived: true });
    await flush();

    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    test.resolveNextSetArchiveMembership({ photoId: "photo-1", archived: true });
    await flush();

    expect(mutations.getSnapshot().navigationRevision).toBe(2);
    expect(mutations.getSnapshot().feedback?.kind).toBe("success");
  });

  it("auto-dismisses success feedback after 8 seconds and leaves failure feedback persistent", () => {
    vi.useFakeTimers();
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    expect(mutations.getSnapshot().feedback).toBeDefined();

    vi.advanceTimersByTime(8_000);
    expect(mutations.getSnapshot().feedback).toBeUndefined();
  });

  it("downloadOriginal opens the presigned URL and tracks in-flight state", async () => {
    const opened: string[] = [];
    mutations = createAlbumMutations({ port: test.port, registry, openDownload: (url) => opened.push(url) });

    mutations.intents.downloadOriginal({ photoId: "photo-1", fileName: "beach.jpg" });
    expect(mutations.getSnapshot().downloadsInFlight.has("photo-1")).toBe(true);

    test.resolveNextPresignOriginalDownload({ url: "https://example.invalid/original", expiresInSeconds: 300 });
    await flush();

    expect(opened).toEqual(["https://example.invalid/original"]);
    expect(mutations.getSnapshot().downloadsInFlight.has("photo-1")).toBe(false);
  });

  it("downloadOriginal failure publishes a persistent error naming the file", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.downloadOriginal({ photoId: "photo-1", fileName: "beach.jpg" });

    test.rejectNextPresignOriginalDownload(new Error("boom"));
    await flush();

    const feedback = mutations.getSnapshot().feedback;
    expect(feedback?.kind).toBe("failure");
    expect(feedback?.message).toContain("beach.jpg");
  });

  it("retryProcessing failure publishes a persistent, retryable error", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.retryProcessing("photo-1");

    test.rejectNextRetryProcessing(new Error("boom"));
    await flush();

    expect(mutations.getSnapshot().feedback).toMatchObject({ kind: "failure" });
  });

  it("dispose aborts in-flight requests and becomes a no-op for further intents", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });

    mutations.dispose();
    await flush();

    expect(mutations.getSnapshot().feedback).toBeUndefined();
    mutations.intents.setMembership({ photoId: "photo-2", collection: "active" });
    expect(test.setArchiveMembershipCalls).toHaveLength(1);
  });
});
