import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowsingHistoryRegistry } from "../browsing/browsingHistoryRegistry.js";
import { createAlbumMutations, type AlbumMutations } from "./albumMutations.js";
import { createTestAlbumMutationsPort, type TestAlbumMutationsPort } from "./testAlbumMutationsPort.js";

const fakeRegistry = (): BrowsingHistoryRegistry => ({
  activate: vi.fn(),
  applyMembershipChange: vi.fn(),
  revertMembershipChange: vi.fn(),
  applyPermanentDeletion: vi.fn(),
  revertPermanentDeletion: vi.fn(),
  notifyPhotosArrived: vi.fn(),
  applyChronologyChange: vi.fn(),
  applyFavouriteChange: vi.fn(),
  revertFavouriteChange: vi.fn(),
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
    expect(mutations.getSnapshot().feedback).toMatchObject({ kind: "success", message: "Photo moved to Trash" });
    expect(test.setTrashMembershipCalls).toEqual([{ photoId: "photo-1", trashed: true }]);
  });

  it("bumps navigationRevision on success without replacing the feedback entry", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    const feedbackId = mutations.getSnapshot().feedback?.id;

    test.resolveNextSetTrashMembership({ photoId: "photo-1", trashed: true });
    await flush();

    expect(mutations.getSnapshot().navigationRevision).toBe(1);
    expect(mutations.getSnapshot().feedback?.id).toBe(feedbackId);
  });

  it("withholds a permanently deleted Photo, then updates navigation only after the deletion succeeds", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.permanentlyDeletePhoto("photo-1");

    expect(registry.applyPermanentDeletion).toHaveBeenCalledWith({ photoId: "photo-1", collection: "trashed" });
    expect(test.permanentlyDeletePhotoCalls).toEqual([{ photoId: "photo-1" }]);
    test.resolveNextPermanentDeletion();
    await flush();
    expect(mutations.getSnapshot()).toMatchObject({ navigationRevision: 1, feedback: { message: "Photo permanently deleted" } });
  });

  it("abandonPhoto permanently deletes without touching the registry, then updates navigation on success", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.abandonPhoto("photo-1");

    expect(registry.applyPermanentDeletion).not.toHaveBeenCalled();
    expect(test.permanentlyDeletePhotoCalls).toEqual([{ photoId: "photo-1" }]);
    test.resolveNextPermanentDeletion();
    await flush();
    expect(mutations.getSnapshot()).toMatchObject({ navigationRevision: 1, feedback: { message: "Photo abandoned" } });
  });

  it("abandonPhoto failure publishes a persistent, retryable error without rolling back a registry it never touched", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.abandonPhoto("photo-1");

    test.rejectNextPermanentDeletion(new Error("boom"));
    await flush();

    expect(registry.revertPermanentDeletion).not.toHaveBeenCalled();
    const feedback = mutations.getSnapshot().feedback;
    expect(feedback).toMatchObject({ kind: "failure", message: "Couldn't abandon this Photo — try again" });
    expect(feedback?.action?.label).toBe("Retry");
  });

  it("refetches Trash after a successful Empty Trash and offers a retry when it fails", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.emptyTrash();
    expect(test.emptyTrashCalls).toBe(1);
    test.resolveNextEmptyTrash();
    await flush();
    expect(mutations.getSnapshot()).toMatchObject({ navigationRevision: 1, trashRevision: 1, feedback: { message: "Trash permanently emptied" } });

    mutations.intents.emptyTrash();
    test.rejectNextEmptyTrash(new Error("boom"));
    await flush();
    expect(mutations.getSnapshot().feedback).toMatchObject({ kind: "failure", message: "Couldn't empty Trash — try again" });
  });

  it("on failure, rolls back membership (not navigation) and replaces feedback with a persistent, retryable failure", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });

    test.rejectNextSetTrashMembership(new Error("boom"));
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
    expect(test.setTrashMembershipCalls).toEqual([
      { photoId: "photo-1", trashed: true },
      { photoId: "photo-1", trashed: false },
    ]);
  });

  it("treats a re-trash of an already-trashed Photo as an ordinary success (server idempotency)", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    test.resolveNextSetTrashMembership({ photoId: "photo-1", trashed: true });
    await flush();

    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    test.resolveNextSetTrashMembership({ photoId: "photo-1", trashed: true });
    await flush();

    expect(mutations.getSnapshot().navigationRevision).toBe(2);
    expect(mutations.getSnapshot().feedback?.kind).toBe("success");
  });

  it("does not auto-dismiss action-bearing success feedback (Undo persists until acted on, dismissed, or replaced)", () => {
    vi.useFakeTimers();
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });
    expect(mutations.getSnapshot().feedback).toMatchObject({ kind: "success", action: { label: "Undo" } });

    vi.advanceTimersByTime(8_000);
    expect(mutations.getSnapshot().feedback).toBeDefined();
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

  it("setFavourite applies an optimistic override immediately, before the request resolves", () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.setFavourite({ photoId: "photo-1", favourite: true, sourceCollection: "active" });

    expect(mutations.getSnapshot().favouriteOverrides.get("photo-1")).toBe(true);
    expect(test.setFavouriteCalls).toEqual([{ photoId: "photo-1", favourite: true }]);
    expect(mutations.getSnapshot().feedback).toBeUndefined();
    expect(registry.applyFavouriteChange).toHaveBeenCalledWith({ photoId: "photo-1", favourite: true });
  });

  it("setFavourite keeps the optimistic override on success, without publishing feedback, and bumps navigationRevision", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setFavourite({ photoId: "photo-1", favourite: true, sourceCollection: "active" });
    const revisionBefore = mutations.getSnapshot().navigationRevision;

    test.resolveNextSetFavourite({ photoId: "photo-1", favourite: true });
    await flush();

    expect(mutations.getSnapshot().favouriteOverrides.get("photo-1")).toBe(true);
    expect(mutations.getSnapshot().feedback).toBeUndefined();
    expect(mutations.getSnapshot().navigationRevision).toBe(revisionBefore + 1);
  });

  it("setFavourite reverts the optimistic override and publishes a retryable failure", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setFavourite({ photoId: "photo-1", favourite: true, sourceCollection: "active" });

    test.rejectNextSetFavourite(new Error("boom"));
    await flush();

    expect(mutations.getSnapshot().favouriteOverrides.get("photo-1")).toBe(false);
    expect(mutations.getSnapshot().feedback).toMatchObject({ kind: "failure", action: { label: "Retry" } });
    expect(registry.revertFavouriteChange).toHaveBeenCalledWith({ photoId: "photo-1" });
  });

  it("unfavouriting from the Timeline stays silent (decision 5)", () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.setFavourite({ photoId: "photo-1", favourite: false, sourceCollection: "active" });

    expect(mutations.getSnapshot().feedback).toBeUndefined();
    expect(registry.applyFavouriteChange).toHaveBeenCalledWith({ photoId: "photo-1", favourite: false });
  });

  it("unfavouriting from Favourites publishes Undo feedback, since the Photo disappears from view (decision 5)", () => {
    mutations = createAlbumMutations({ port: test.port, registry });

    mutations.intents.setFavourite({ photoId: "photo-1", favourite: false, sourceCollection: "favourite" });

    expect(mutations.getSnapshot().feedback).toMatchObject({
      kind: "success",
      message: "Removed from Favourites",
      action: { label: "Undo" },
    });
  });

  it("Undo from a Favourites unfavourite re-favourites silently", () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setFavourite({ photoId: "photo-1", favourite: false, sourceCollection: "favourite" });
    const undo = mutations.getSnapshot().feedback?.action;

    undo?.onInvoke();

    expect(test.setFavouriteCalls).toEqual([
      { photoId: "photo-1", favourite: false },
      { photoId: "photo-1", favourite: true },
    ]);
    expect(mutations.getSnapshot().feedback).toBeUndefined();
  });

  it("dispose aborts in-flight requests and becomes a no-op for further intents", async () => {
    mutations = createAlbumMutations({ port: test.port, registry });
    mutations.intents.setMembership({ photoId: "photo-1", collection: "active" });

    mutations.dispose();
    await flush();

    expect(mutations.getSnapshot().feedback).toBeUndefined();
    mutations.intents.setMembership({ photoId: "photo-2", collection: "active" });
    expect(test.setTrashMembershipCalls).toHaveLength(1);
  });
});
