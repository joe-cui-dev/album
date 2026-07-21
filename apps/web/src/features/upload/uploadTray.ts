import type {
  CreateUploadBatchResponse,
  GetUploadBatchStatusResponse,
  ProcessingIssueReasonCode,
  ProcessingState,
  UploadBatchPhotoStatus,
} from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import type { BrowsingHistoryRegistry } from "../browsing/browsingHistoryRegistry.js";
import { validatePhotoFile, validateUploadBatchFiles } from "./fileValidation.js";
import { hashFile } from "./hashFile.js";
import { isTerminalProcessingState } from "./uploadState.js";
import { UploadToS3Error } from "./uploadToS3.js";
import type { UploadTrayPort } from "./uploadTrayPort.js";

export interface UploadTraySelectionEntry {
  id: string;
  file: File;
  fileName: string;
  fileSizeBytes: number;
  valid: boolean;
  validationReason?: string;
}

export type UploadTransferState = "queued" | "uploading" | "uploaded" | "failed";

export interface UploadTrayTransfer {
  id: string;
  photoId: string;
  fileName: string;
  progress: number;
  transferState: UploadTransferState;
  transferError?: string;
  processingState: ProcessingState;
  exactDuplicate: boolean;
  duplicateOfPhotoId?: string;
  failureCode?: ProcessingIssueReasonCode;
  failureMessage?: string;
  timelineAnchor?: string;
}

export interface UploadTrayCompletion {
  added: number;
  alreadyInAlbum: number;
  needsAttention: number;
  /** The period to jump to for "View new photos" -- the newest-Captured-At new Ready Photo's anchor. */
  newestReadyTimelineAnchor?: string;
}

export interface UploadTraySnapshot {
  visible: boolean;
  minimized: boolean;
  /** True while checking `sessionStorage` for a recoverable batch just after album load (ADR-0069). */
  recovering: boolean;
  selection: UploadTraySelectionEntry[];
  selectionWarning?: string;
  submitting: boolean;
  uploadBatchId?: string;
  transfers: UploadTrayTransfer[];
  /** True once every Photo in the batch has reached a terminal processing state. */
  terminal: boolean;
  completion?: UploadTrayCompletion;
  jumping: boolean;
}

export interface UploadTrayIntents {
  open(): void;
  minimize(): void;
  addFiles(files: File[]): void;
  removeFile(id: string): void;
  startUpload(): void;
  /** Resets the Tray to closed/idle after the User has seen the completion summary. */
  dismiss(): void;
  viewNewPhotos(): void;
}

export interface UploadTray {
  getSnapshot(): UploadTraySnapshot;
  subscribe(listener: () => void): () => void;
  intents: UploadTrayIntents;
  dispose(): void;
}

export interface UploadTrayOptions {
  port: UploadTrayPort;
  registry: Pick<BrowsingHistoryRegistry, "notifyPhotosArrived">;
  userId: string;
  /** Test seam for `sessionStorage` (implementation doc "Recovery"). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now?: () => number;
  /** Performs the actual URL change for "View new photos"; production wires this to the router. */
  navigate?: (path: string) => void;
  /** Signals the Processing Issues nav count to refresh (implementation doc "Navigation count"). */
  onBatchTerminal?: () => void;
  maxConcurrentTransfers?: number;
  statusPollIntervalMs?: number;
  isDocumentVisible?: () => boolean;
}

/** ~30 minutes (implementation doc "Recovery"). */
const RECOVERY_FRESHNESS_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_TRANSFERS = 4;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2_000;

const storageKeyFor = (userId: string): string => `album-upload-tray:${userId}`;

const anchorSortKey = (anchor: string): string => {
  const [year, month] = anchor.split("-") as [string, string];
  return `${year}-${month === "unknown" ? "00" : month}`;
};

const isCancelled = (error: unknown): boolean => {
  if (error instanceof AlbumTransportError) {
    return error.code === "cancelled";
  }
  if (error instanceof UploadToS3Error) {
    return error.kind === "cancelled";
  }
  return error instanceof DOMException && error.name === "AbortError";
};

/** The optional per-Photo fields a status response may carry, shared by a live poll and a recovery fetch. */
const optionalStatusFields = (
  photo: UploadBatchPhotoStatus,
): Pick<UploadTrayTransfer, "duplicateOfPhotoId" | "failureCode" | "failureMessage" | "timelineAnchor"> => ({
  ...(photo.duplicateOfPhotoId !== undefined ? { duplicateOfPhotoId: photo.duplicateOfPhotoId } : {}),
  ...(photo.failureCode !== undefined ? { failureCode: photo.failureCode } : {}),
  ...(photo.failureMessage !== undefined ? { failureMessage: photo.failureMessage } : {}),
  ...(photo.timelineAnchor !== undefined ? { timelineAnchor: photo.timelineAnchor } : {}),
});

let selectionCounter = 0;

/**
 * Above-the-router deep module owning file selection, direct S3 transfer,
 * Upload Batch recovery, and completion (implementation doc "Upload Tray").
 * Survives route changes and the Photo Viewer; created once per signed-in
 * User alongside `albumMutations` and the history registry (ADR-0068).
 */
export const createUploadTray = (options: UploadTrayOptions): UploadTray => {
  const { port, registry } = options;
  const storage = options.storage ?? window.sessionStorage;
  const now = options.now ?? (() => Date.now());
  const isDocumentVisible = options.isDocumentVisible ?? (() => document.visibilityState !== "hidden");
  const maxConcurrentTransfers = options.maxConcurrentTransfers ?? DEFAULT_MAX_CONCURRENT_TRANSFERS;
  const statusPollIntervalMs = options.statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS;
  const storageKey = storageKeyFor(options.userId);

  let disposed = false;
  const listeners = new Set<() => void>();
  const inFlightControllers = new Set<AbortController>();

  let visible = false;
  let minimized = false;
  let recovering = true;
  let selection: UploadTraySelectionEntry[] = [];
  let selectionWarning: string | undefined;
  let submitting = false;
  let uploadBatchId: string | undefined;
  let transfers: UploadTrayTransfer[] = [];
  let jumping = false;
  let statusPollTimer: ReturnType<typeof setTimeout> | undefined;
  let beforeUnloadRegistered = false;

  let cachedSnapshot: UploadTraySnapshot | undefined;

  const notify = (): void => {
    cachedSnapshot = undefined;
    for (const listener of listeners) {
      listener();
    }
  };

  const isBatchTerminal = (): boolean =>
    transfers.length > 0 && transfers.every((transfer) => isTerminalProcessingState(transfer.processingState));

  const computeCompletion = (): UploadTrayCompletion | undefined => {
    if (!isBatchTerminal()) {
      return undefined;
    }
    const added = transfers.filter((transfer) => transfer.processingState === "ready").length;
    const alreadyInAlbum = transfers.filter((transfer) => transfer.processingState === "exactDuplicate").length;
    const needsAttention = transfers.filter((transfer) => transfer.processingState === "processingFailed").length;
    const readyAnchors = transfers
      .filter((transfer) => transfer.processingState === "ready" && transfer.timelineAnchor !== undefined)
      .map((transfer) => transfer.timelineAnchor as string);
    const newestReadyTimelineAnchor = readyAnchors.length
      ? readyAnchors.reduce((newest, anchor) => (anchorSortKey(anchor) > anchorSortKey(newest) ? anchor : newest))
      : undefined;
    return {
      added,
      alreadyInAlbum,
      needsAttention,
      ...(newestReadyTimelineAnchor !== undefined ? { newestReadyTimelineAnchor } : {}),
    };
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = "";
  };

  const registerBeforeUnload = (): void => {
    if (beforeUnloadRegistered) {
      return;
    }
    beforeUnloadRegistered = true;
    window.addEventListener("beforeunload", handleBeforeUnload);
  };

  const removeBeforeUnloadListener = (): void => {
    if (!beforeUnloadRegistered) {
      return;
    }
    beforeUnloadRegistered = false;
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };

  const maybeClearBeforeUnload = (): void => {
    if (transfers.every((transfer) => transfer.transferState === "uploaded" || transfer.transferState === "failed")) {
      removeBeforeUnloadListener();
    }
  };

  const recomputeSelectionWarning = (): void => {
    const batchValidation = validateUploadBatchFiles(
      selection.filter((entry) => entry.valid).map((entry) => entry.file),
    );
    selectionWarning = batchValidation.valid ? undefined : batchValidation.reason;
  };

  const updateTransfer = (photoId: string, patch: Partial<UploadTrayTransfer>): void => {
    if (disposed) {
      return;
    }
    transfers = transfers.map((transfer) => (transfer.photoId === photoId ? { ...transfer, ...patch } : transfer));
    notify();
  };

  const applyStatus = (status: GetUploadBatchStatusResponse): void => {
    const byPhotoId = new Map<string, UploadBatchPhotoStatus>(status.photos.map((photo) => [photo.photoId, photo]));
    transfers = transfers.map((transfer) => {
      const photo = byPhotoId.get(transfer.photoId);
      if (!photo) {
        return transfer;
      }
      return {
        ...transfer,
        processingState: photo.processingState,
        exactDuplicate: photo.exactDuplicate,
        ...optionalStatusFields(photo),
      };
    });
    notify();
  };

  const onTerminalReached = (): void => {
    storage.removeItem(storageKey);
    registry.notifyPhotosArrived();
    options.onBatchTerminal?.();
    notify();
  };

  const scheduleStatusPoll = (): void => {
    if (disposed) {
      return;
    }
    statusPollTimer = setTimeout(() => {
      statusPollTimer = undefined;
      void pollStatusOnce();
    }, statusPollIntervalMs);
  };

  const pollStatusOnce = async (): Promise<void> => {
    if (disposed || uploadBatchId === undefined) {
      return;
    }
    if (!isDocumentVisible()) {
      scheduleStatusPoll();
      return;
    }
    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      const status = await port.getUploadBatchStatus({ uploadBatchId, signal: controller.signal });
      if (disposed) {
        return;
      }
      applyStatus(status);
    } catch {
      // A transient poll failure isn't surfaced; the next tick simply tries again.
    } finally {
      inFlightControllers.delete(controller);
    }
    if (disposed) {
      return;
    }
    if (isBatchTerminal()) {
      onTerminalReached();
      return;
    }
    scheduleStatusPoll();
  };

  const runOneTransfer = async (photoId: string, file: File, uploadUrl: string): Promise<void> => {
    updateTransfer(photoId, { transferState: "uploading" });
    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      await port.uploadFile({
        file,
        uploadUrl,
        onProgress: (percent) => updateTransfer(photoId, { progress: percent }),
        signal: controller.signal,
      });
      if (disposed) {
        return;
      }
      updateTransfer(photoId, { transferState: "uploaded", progress: 100 });
    } catch (error) {
      if (disposed || isCancelled(error)) {
        return;
      }
      const message =
        error instanceof UploadToS3Error && error.kind === "expired" ? error.message : "Upload failed — try again";
      updateTransfer(photoId, { transferState: "failed", transferError: message });
    } finally {
      inFlightControllers.delete(controller);
    }
  };

  const runTransfers = async (
    uploads: CreateUploadBatchResponse["uploads"],
    files: UploadTraySelectionEntry[],
  ): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!disposed) {
        const index = cursor;
        if (index >= uploads.length) {
          return;
        }
        cursor += 1;
        const upload = uploads[index] as CreateUploadBatchResponse["uploads"][number];
        const file = (files[index] as UploadTraySelectionEntry).file;
        await runOneTransfer(upload.photoId, file, upload.uploadUrl);
      }
    };
    const workerCount = Math.min(maxConcurrentTransfers, uploads.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    if (disposed) {
      return;
    }
    maybeClearBeforeUnload();
  };

  const runStartUpload = async (): Promise<void> => {
    if (disposed || submitting) {
      return;
    }
    if (uploadBatchId !== undefined && !isBatchTerminal()) {
      return;
    }
    const validFiles = selection.filter((entry) => entry.valid);
    const batchValidation = validateUploadBatchFiles(validFiles.map((entry) => entry.file));
    if (!batchValidation.valid) {
      selectionWarning = batchValidation.reason;
      notify();
      return;
    }
    if (validFiles.length === 0) {
      return;
    }

    submitting = true;
    selectionWarning = undefined;
    notify();

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const files = await Promise.all(
      validFiles.map(async (entry) => {
        let clientSha256: string | undefined;
        try {
          clientSha256 = await hashFile(entry.file);
        } catch {
          // Best-effort de-dup hint only; the batch still proceeds without it.
        }
        return {
          fileName: entry.file.name,
          contentType: entry.file.type,
          fileSizeBytes: entry.file.size,
          ...(clientSha256 !== undefined ? { clientSha256 } : {}),
          fileModifiedAt: new Date(entry.file.lastModified).toISOString(),
        };
      }),
    );
    if (disposed) {
      return;
    }

    const controller = new AbortController();
    inFlightControllers.add(controller);
    let batch: CreateUploadBatchResponse;
    try {
      batch = await port.createUploadBatch({ files, uploadContext: { timeZone }, signal: controller.signal });
    } catch (error) {
      inFlightControllers.delete(controller);
      if (disposed || isCancelled(error)) {
        return;
      }
      submitting = false;
      selectionWarning = "Couldn't start the upload — try again";
      notify();
      return;
    }
    inFlightControllers.delete(controller);
    if (disposed) {
      return;
    }

    uploadBatchId = batch.uploadBatchId;
    storage.setItem(storageKey, JSON.stringify({ uploadBatchId: batch.uploadBatchId, startedAt: now() }));
    transfers = batch.uploads.map((upload, index) => ({
      id: (validFiles[index] as UploadTraySelectionEntry).id,
      photoId: upload.photoId,
      fileName: (validFiles[index] as UploadTraySelectionEntry).file.name,
      progress: 0,
      transferState: "queued",
      processingState: "uploadRequested",
      exactDuplicate: false,
    }));
    selection = [];
    submitting = false;
    visible = true;
    minimized = false;
    notify();

    registerBeforeUnload();
    void runTransfers(batch.uploads, validFiles);
    void pollStatusOnce();
  };

  const runRecover = async (): Promise<void> => {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      recovering = false;
      notify();
      return;
    }
    let parsed: { uploadBatchId?: unknown; startedAt?: unknown } | undefined;
    try {
      parsed = JSON.parse(raw) as { uploadBatchId?: unknown; startedAt?: unknown };
    } catch {
      parsed = undefined;
    }
    if (typeof parsed?.uploadBatchId !== "string" || typeof parsed.startedAt !== "number") {
      storage.removeItem(storageKey);
      recovering = false;
      notify();
      return;
    }
    if (now() - parsed.startedAt > RECOVERY_FRESHNESS_WINDOW_MS) {
      storage.removeItem(storageKey);
      recovering = false;
      notify();
      return;
    }

    const recoveredBatchId = parsed.uploadBatchId;
    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      const status = await port.getUploadBatchStatus({ uploadBatchId: recoveredBatchId, signal: controller.signal });
      if (disposed) {
        return;
      }
      const stillActive = status.photos.some(
        (photo) => photo.processingState === "uploadRequested" || photo.processingState === "processing",
      );
      if (!stillActive) {
        storage.removeItem(storageKey);
        recovering = false;
        notify();
        return;
      }
      uploadBatchId = recoveredBatchId;
      transfers = status.photos.map((photo) => ({
        id: photo.photoId,
        photoId: photo.photoId,
        fileName: photo.fileName,
        progress: 100,
        transferState: "uploaded" as const,
        processingState: photo.processingState,
        exactDuplicate: photo.exactDuplicate,
        ...optionalStatusFields(photo),
      }));
      visible = true;
      minimized = true;
      recovering = false;
      notify();
      void pollStatusOnce();
    } catch (error) {
      if (disposed || isCancelled(error)) {
        return;
      }
      // An unreadable recovered batch is treated like a stale one -- it shouldn't block the Tray forever.
      storage.removeItem(storageKey);
      recovering = false;
      notify();
    } finally {
      inFlightControllers.delete(controller);
    }
  };

  const runViewNewPhotos = async (targetAnchor: string): Promise<void> => {
    if (disposed || jumping) {
      return;
    }
    jumping = true;
    notify();
    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      const result = await port.probeDateJump({ targetAnchor, signal: controller.signal });
      if (disposed) {
        return;
      }
      if (result.outcome === "committed") {
        minimized = true;
        options.navigate?.(`/album?startAt=${encodeURIComponent(targetAnchor)}`);
      }
    } catch {
      // The probe failed or was cancelled; the button stays available to try again.
    } finally {
      inFlightControllers.delete(controller);
      if (!disposed) {
        jumping = false;
        notify();
      }
    }
  };

  const intents: UploadTrayIntents = {
    open: () => {
      if (disposed) {
        return;
      }
      visible = true;
      minimized = false;
      notify();
    },
    minimize: () => {
      if (disposed || minimized) {
        return;
      }
      minimized = true;
      notify();
    },
    addFiles: (files) => {
      if (disposed || files.length === 0) {
        return;
      }
      const additions: UploadTraySelectionEntry[] = files.map((file) => {
        const validation = validatePhotoFile(file);
        selectionCounter += 1;
        return {
          id: `${file.name}-${file.lastModified}-${file.size}-${selectionCounter}`,
          file,
          fileName: file.name,
          fileSizeBytes: file.size,
          valid: validation.valid,
          ...(validation.reason !== undefined ? { validationReason: validation.reason } : {}),
        };
      });
      selection = [...selection, ...additions];
      visible = true;
      recomputeSelectionWarning();
      notify();
    },
    removeFile: (id) => {
      if (disposed) {
        return;
      }
      selection = selection.filter((entry) => entry.id !== id);
      recomputeSelectionWarning();
      notify();
    },
    startUpload: () => {
      void runStartUpload();
    },
    dismiss: () => {
      if (disposed) {
        return;
      }
      visible = false;
      minimized = false;
      selection = [];
      selectionWarning = undefined;
      uploadBatchId = undefined;
      transfers = [];
      notify();
    },
    viewNewPhotos: () => {
      const anchor = computeCompletion()?.newestReadyTimelineAnchor;
      if (anchor !== undefined) {
        void runViewNewPhotos(anchor);
      }
    },
  };

  void runRecover();

  return {
    getSnapshot: () => {
      if (!cachedSnapshot) {
        const completion = computeCompletion();
        cachedSnapshot = {
          visible,
          minimized,
          recovering,
          selection,
          ...(selectionWarning !== undefined ? { selectionWarning } : {}),
          submitting,
          ...(uploadBatchId !== undefined ? { uploadBatchId } : {}),
          transfers,
          terminal: isBatchTerminal(),
          ...(completion !== undefined ? { completion } : {}),
          jumping,
        };
      }
      return cachedSnapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    intents,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (statusPollTimer !== undefined) {
        clearTimeout(statusPollTimer);
        statusPollTimer = undefined;
      }
      for (const controller of inFlightControllers) {
        controller.abort();
      }
      inFlightControllers.clear();
      removeBeforeUnloadListener();
      // Session loss and Sign Out both clear the recovery key outright (implementation doc "Recovery").
      storage.removeItem(storageKey);
      listeners.clear();
    },
  };
};
