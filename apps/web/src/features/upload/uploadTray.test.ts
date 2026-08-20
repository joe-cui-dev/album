import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowsingHistoryRegistry } from "../browsing/browsingHistoryRegistry.js";
import { createUploadTray, type UploadTray } from "./uploadTray.js";
import { createTestUploadTrayPort, type TestUploadTrayPort } from "./testUploadTrayPort.js";
import { UploadToS3Error } from "./uploadToS3.js";

vi.mock("./hashFile.js", () => ({ hashFile: vi.fn(async () => "hash-value") }));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

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

const fakeStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
};

const photoFile = (name: string): File => new File(["data"], name, { type: "image/jpeg" });

const uploadForFile = (index: number) => ({
  photoId: `photo-${index}`,
  objectKey: `originals/user-1/batch-1/photo-${index}`,
  uploadUrl: `https://upload.example/photo-${index}`,
  duplicate: false,
});

describe("createUploadTray", () => {
  let port: TestUploadTrayPort;
  let registry: BrowsingHistoryRegistry;
  let storage: Storage;
  let tray: UploadTray | undefined;
  let onBatchTerminal: ReturnType<typeof vi.fn<() => void>>;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;

  const create = (overrides: Partial<Parameters<typeof createUploadTray>[0]> = {}): UploadTray => {
    tray = createUploadTray({
      port: port.port,
      registry,
      userId: "user-1",
      storage,
      onBatchTerminal,
      navigate,
      ...overrides,
    });
    return tray;
  };

  beforeEach(() => {
    port = createTestUploadTrayPort();
    registry = fakeRegistry();
    storage = fakeStorage();
    onBatchTerminal = vi.fn();
    navigate = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    tray?.dispose();
    tray = undefined;
    vi.useRealTimers();
  });

  describe("recovery gating", () => {
    it("is not recovering and stays hidden with nothing in storage", async () => {
      create();
      await flush();
      expect(tray!.getSnapshot()).toMatchObject({ recovering: false, visible: false });
      expect(port.getUploadBatchStatusCalls).toEqual([]);
    });

    it("clears a stale entry outside the ~30 minute freshness window without fetching", async () => {
      storage.setItem("album-upload-tray:user-1", JSON.stringify({ uploadBatchId: "batch-1", startedAt: 0 }));
      create({ now: () => 31 * 60 * 1000 });
      await flush();

      expect(port.getUploadBatchStatusCalls).toEqual([]);
      expect(storage.getItem("album-upload-tray:user-1")).toBeNull();
      expect(tray!.getSnapshot()).toMatchObject({ recovering: false, visible: false });
    });

    it("recovers and shows the Tray when a Photo is still uploadRequested or processing", async () => {
      storage.setItem("album-upload-tray:user-1", JSON.stringify({ uploadBatchId: "batch-1", startedAt: 1000 }));
      create({ now: () => 1000 });
      await flush();

      port.resolveNextGetUploadBatchStatus({
        uploadBatchId: "batch-1",
        counts: { uploadRequested: 0, processing: 1, ready: 0, processingFailed: 0, exactDuplicate: 0 },
        photos: [{ photoId: "photo-1", fileName: "a.jpg", processingState: "processing", exactDuplicate: false }],
      });
      await flush();

      const snapshot = tray!.getSnapshot();
      expect(snapshot.recovering).toBe(false);
      expect(snapshot.visible).toBe(true);
      expect(snapshot.minimized).toBe(true);
      expect(snapshot.uploadBatchId).toBe("batch-1");
      expect(snapshot.transfers).toEqual([
        expect.objectContaining({ photoId: "photo-1", transferState: "uploaded", processingState: "processing" }),
      ]);
    });

    it("clears the entry and stays hidden when every recovered Photo is already terminal", async () => {
      storage.setItem("album-upload-tray:user-1", JSON.stringify({ uploadBatchId: "batch-1", startedAt: 1000 }));
      create({ now: () => 1000 });
      await flush();

      port.resolveNextGetUploadBatchStatus({
        uploadBatchId: "batch-1",
        counts: { uploadRequested: 0, processing: 0, ready: 1, processingFailed: 0, exactDuplicate: 0 },
        photos: [{ photoId: "photo-1", fileName: "a.jpg", processingState: "ready", exactDuplicate: false }],
      });
      await flush();

      expect(tray!.getSnapshot()).toMatchObject({ recovering: false, visible: false });
      expect(storage.getItem("album-upload-tray:user-1")).toBeNull();
    });
  });

  describe("selection", () => {
    it("flags a batch over the 100-file limit without blocking individually valid files", async () => {
      create();
      await flush();
      const files = Array.from({ length: 101 }, (_, index) => photoFile(`f${index}.jpg`));

      tray!.intents.addFiles(files);

      expect(tray!.getSnapshot().selectionWarning).toBe("Choose 100 photos or fewer");
    });

    it("removes a file from the selection", async () => {
      create();
      await flush();
      tray!.intents.addFiles([photoFile("a.jpg")]);
      const id = tray!.getSnapshot().selection[0]!.id;

      tray!.intents.removeFile(id);

      expect(tray!.getSnapshot().selection).toEqual([]);
    });
  });

  describe("upload transfer", () => {
    const startUploadWithFiles = async (count: number): Promise<void> => {
      create();
      await flush();
      tray!.intents.addFiles(Array.from({ length: count }, (_, index) => photoFile(`f${index}.jpg`)));
      tray!.intents.startUpload();
      await flush();
      port.resolveNextCreateUploadBatch({
        uploadBatchId: "batch-1",
        uploads: Array.from({ length: count }, (_, index) => uploadForFile(index)),
      });
      await flush();
    };

    it("bounds concurrent transfers to 4", async () => {
      await startUploadWithFiles(6);

      expect(port.uploadFileCalls).toHaveLength(4);
      expect(port.inFlightUploadFileCount()).toBe(4);

      port.resolveNextUploadFile();
      await flush();

      expect(port.uploadFileCalls).toHaveLength(5);
      expect(port.inFlightUploadFileCount()).toBe(4);
    });

    it("surfaces an expired presign as a distinct message and does not treat it as a bounded-queue slot leak", async () => {
      await startUploadWithFiles(1);

      port.rejectNextUploadFile(new UploadToS3Error("expired", "Selection expired — add these again"));
      await flush();

      expect(tray!.getSnapshot().transfers[0]).toMatchObject({
        transferState: "failed",
        transferError: "Selection expired — add these again",
      });
    });

    it("surfaces a non-network, non-expired failure with a generic retry message", async () => {
      await startUploadWithFiles(1);

      port.rejectNextUploadFile(new UploadToS3Error("failed", "Upload failed"));
      await flush();

      expect(tray!.getSnapshot().transfers[0]).toMatchObject({
        transferState: "failed",
        transferError: "Upload failed — try again",
      });
    });
  });

  describe("terminal completion", () => {
    const runToTerminal = async (photos: Array<Record<string, unknown>>, counts: Record<string, number>) => {
      await create();
      await flush();
      tray!.intents.addFiles([photoFile("a.jpg")]);
      tray!.intents.startUpload();
      await flush();
      port.resolveNextCreateUploadBatch({ uploadBatchId: "batch-1", uploads: [uploadForFile(0)] });
      await flush();
      port.resolveNextUploadFile();
      await flush();

      await vi.advanceTimersByTimeAsync(2_000);
      port.resolveNextGetUploadBatchStatus({
        uploadBatchId: "batch-1",
        counts: counts as never,
        photos: photos as never,
      });
      await flush();
    };

    it("computes completion counts and reports the batch as terminal", async () => {
      await runToTerminal(
        [{ photoId: "photo-0", fileName: "a.jpg", processingState: "ready", exactDuplicate: false, timelineAnchor: "2026-03" }],
        { uploadRequested: 0, processing: 0, ready: 1, processingFailed: 0, exactDuplicate: 0 },
      );

      const snapshot = tray!.getSnapshot();
      expect(snapshot.terminal).toBe(true);
      expect(snapshot.completion).toEqual({ added: 1, alreadyInAlbum: 0, needsAttention: 0, newestReadyTimelineAnchor: "2026-03" });
    });

    it("notifies the registry and the caller once the batch reaches terminal state, and clears the recovery key", async () => {
      await runToTerminal(
        [{ photoId: "photo-0", fileName: "a.jpg", processingState: "ready", exactDuplicate: false }],
        { uploadRequested: 0, processing: 0, ready: 1, processingFailed: 0, exactDuplicate: 0 },
      );

      expect(registry.notifyPhotosArrived).toHaveBeenCalledTimes(1);
      expect(onBatchTerminal).toHaveBeenCalledTimes(1);
      expect(storage.getItem("album-upload-tray:user-1")).toBeNull();
    });

    it("picks the newest ready timelineAnchor, preferring known months over Date Unknown", async () => {
      port = createTestUploadTrayPort();
      create();
      await flush();
      tray!.intents.addFiles([photoFile("a.jpg"), photoFile("b.jpg")]);
      tray!.intents.startUpload();
      await flush();
      port.resolveNextCreateUploadBatch({ uploadBatchId: "batch-1", uploads: [uploadForFile(0), uploadForFile(1)] });
      await flush();
      port.resolveNextUploadFile();
      port.resolveNextUploadFile();
      await flush();

      await vi.advanceTimersByTimeAsync(2_000);
      port.resolveNextGetUploadBatchStatus({
        uploadBatchId: "batch-1",
        counts: { uploadRequested: 0, processing: 0, ready: 2, processingFailed: 0, exactDuplicate: 0 },
        photos: [
          { photoId: "photo-0", fileName: "a.jpg", processingState: "ready", exactDuplicate: false, timelineAnchor: "2026-unknown" },
          { photoId: "photo-1", fileName: "b.jpg", processingState: "ready", exactDuplicate: false, timelineAnchor: "2026-03" },
        ],
      });
      await flush();

      expect(tray!.getSnapshot().completion?.newestReadyTimelineAnchor).toBe("2026-03");
    });

    it("navigates on 'View new photos' when the probe commits", async () => {
      await runToTerminal(
        [{ photoId: "photo-0", fileName: "a.jpg", processingState: "ready", exactDuplicate: false, timelineAnchor: "2026-03" }],
        { uploadRequested: 0, processing: 0, ready: 1, processingFailed: 0, exactDuplicate: 0 },
      );

      tray!.intents.viewNewPhotos();
      await flush();
      expect(port.probeDateJumpCalls).toEqual(["2026-03"]);

      port.resolveNextProbeDateJump({ outcome: "committed", page: { photos: [] } });
      await flush();

      expect(navigate).toHaveBeenCalledWith("/album?startAt=2026-03", { state: { focusMainHeading: true } });
      expect(tray!.getSnapshot().minimized).toBe(true);
      expect(tray!.getSnapshot().jumping).toBe(false);
    });
  });

  describe("dispose", () => {
    it("clears the recovery key even mid-batch", async () => {
      create();
      await flush();
      tray!.intents.addFiles([photoFile("a.jpg")]);
      tray!.intents.startUpload();
      await flush();
      port.resolveNextCreateUploadBatch({ uploadBatchId: "batch-1", uploads: [uploadForFile(0)] });
      await flush();

      expect(storage.getItem("album-upload-tray:user-1")).not.toBeNull();
      tray!.dispose();
      expect(storage.getItem("album-upload-tray:user-1")).toBeNull();
    });
  });
});
