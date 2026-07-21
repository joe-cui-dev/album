import type { PhotoCollection } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import type { BrowsingHistoryRegistry } from "../browsing/browsingHistoryRegistry.js";
import type { AlbumMutationsPort } from "./albumMutationsPort.js";

export interface FeedbackAction {
  label: string;
  onInvoke(): void;
}

export interface FeedbackEntry {
  id: string;
  kind: "success" | "failure";
  message: string;
  action?: FeedbackAction;
}

export interface AlbumMutationsSnapshot {
  feedback?: FeedbackEntry;
  /** Bumped after every successful membership mutation so navigation reads can eagerly refetch (implementation doc "Mutation Foundations"). */
  navigationRevision: number;
  /** Photo ids with an Original Download presign currently in flight ("Preparing download…"). */
  downloadsInFlight: ReadonlySet<string>;
}

export interface AlbumMutationsIntents {
  /** `collection` is the collection the Photo is currently in and about to leave (ADR-0067). */
  setMembership(input: { photoId: string; collection: PhotoCollection }): void;
  retryProcessing(photoId: string): void;
  downloadOriginal(input: { photoId: string; fileName: string }): void;
  dismissFeedback(): void;
}

export interface AlbumMutations {
  getSnapshot(): AlbumMutationsSnapshot;
  subscribe(listener: () => void): () => void;
  intents: AlbumMutationsIntents;
  dispose(): void;
}

export interface AlbumMutationsOptions {
  port: AlbumMutationsPort;
  registry: BrowsingHistoryRegistry;
  /** Success feedback auto-dismiss delay; defaults to 8000ms (implementation doc "Feedback region"). */
  successDismissMs?: number;
  /** Test seam for opening the download URL instead of `window.location.assign`. */
  openDownload?: (url: string) => void;
}

let nextFeedbackId = 0;

export const createAlbumMutations = (options: AlbumMutationsOptions): AlbumMutations => {
  const { port, registry } = options;
  const successDismissMs = options.successDismissMs ?? 8_000;
  const openDownload = options.openDownload ?? ((url: string) => window.location.assign(url));

  let disposed = false;
  const listeners = new Set<() => void>();
  const inFlightControllers = new Set<AbortController>();

  let feedback: FeedbackEntry | undefined;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let navigationRevision = 0;
  const downloadsInFlight = new Set<string>();

  let cachedSnapshot: AlbumMutationsSnapshot | undefined;

  const notify = (): void => {
    cachedSnapshot = undefined;
    for (const listener of listeners) {
      listener();
    }
  };

  const clearFeedbackTimer = (): void => {
    if (feedbackTimer !== undefined) {
      clearTimeout(feedbackTimer);
      feedbackTimer = undefined;
    }
  };

  const publishFeedback = (entry: Omit<FeedbackEntry, "id">): void => {
    clearFeedbackTimer();
    feedback = { ...entry, id: String(nextFeedbackId++) };
    if (entry.kind === "success") {
      feedbackTimer = setTimeout(() => {
        feedbackTimer = undefined;
        feedback = undefined;
        notify();
      }, successDismissMs);
    }
    notify();
  };

  /**
   * `fromCollection` always names the collection the Photo left in the *original* action;
   * `registryOp` distinguishes that forward action ("apply", withholds it there) from
   * reversing it ("revert", un-withholds it there) -- Undo and a failure rollback both
   * reverse, they just differ in whether a request has already been sent.
   */
  const runMembershipChange = async (
    photoId: string,
    fromCollection: PhotoCollection,
    registryOp: "apply" | "revert",
  ): Promise<void> => {
    if (disposed) {
      return;
    }
    const forwardArchived = fromCollection === "active";
    const archived = registryOp === "apply" ? forwardArchived : !forwardArchived;

    if (registryOp === "apply") {
      registry.applyMembershipChange({ photoId, leftCollection: fromCollection });
    } else {
      registry.revertMembershipChange({ photoId, leftCollection: fromCollection });
    }
    publishFeedback({
      kind: "success",
      message: archived ? "Photo moved to Archive" : "Photo restored to Timeline",
      action: {
        label: "Undo",
        onInvoke: () => void runMembershipChange(photoId, fromCollection, registryOp === "apply" ? "revert" : "apply"),
      },
    });

    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      await port.setArchiveMembership({ photoId, archived, signal: controller.signal });
      if (disposed) {
        return;
      }
      navigationRevision += 1;
      notify();
    } catch (error) {
      if (disposed || isCancelled(error)) {
        return;
      }
      if (registryOp === "apply") {
        registry.revertMembershipChange({ photoId, leftCollection: fromCollection });
      } else {
        registry.applyMembershipChange({ photoId, leftCollection: fromCollection });
      }
      publishFeedback({
        kind: "failure",
        message: archived ? "Couldn't archive this Photo — try again" : "Couldn't restore this Photo — try again",
        action: {
          label: "Retry",
          onInvoke: () => void runMembershipChange(photoId, fromCollection, registryOp),
        },
      });
    } finally {
      inFlightControllers.delete(controller);
    }
  };

  const runRetryProcessing = async (photoId: string): Promise<void> => {
    if (disposed) {
      return;
    }
    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      await port.retryProcessing({ photoId, signal: controller.signal });
    } catch (error) {
      if (disposed || isCancelled(error)) {
        return;
      }
      publishFeedback({
        kind: "failure",
        message: "Couldn't start Retry Processing — try again",
        action: {
          label: "Retry",
          onInvoke: () => void runRetryProcessing(photoId),
        },
      });
    } finally {
      inFlightControllers.delete(controller);
    }
  };

  const runDownloadOriginal = async (photoId: string, fileName: string): Promise<void> => {
    if (disposed) {
      return;
    }
    downloadsInFlight.add(photoId);
    notify();
    const controller = new AbortController();
    inFlightControllers.add(controller);
    try {
      const response = await port.presignOriginalDownload({ photoId, signal: controller.signal });
      if (disposed) {
        return;
      }
      openDownload(response.url);
    } catch (error) {
      if (disposed || isCancelled(error)) {
        return;
      }
      publishFeedback({
        kind: "failure",
        message: `Couldn't prepare ${fileName} for download — try again`,
        action: {
          label: "Retry",
          onInvoke: () => void runDownloadOriginal(photoId, fileName),
        },
      });
    } finally {
      inFlightControllers.delete(controller);
      downloadsInFlight.delete(photoId);
      if (!disposed) {
        notify();
      }
    }
  };

  const intents: AlbumMutationsIntents = {
    setMembership: ({ photoId, collection }) => {
      void runMembershipChange(photoId, collection, "apply");
    },
    retryProcessing: (photoId) => {
      void runRetryProcessing(photoId);
    },
    downloadOriginal: ({ photoId, fileName }) => {
      void runDownloadOriginal(photoId, fileName);
    },
    dismissFeedback: () => {
      if (feedback === undefined) {
        return;
      }
      clearFeedbackTimer();
      feedback = undefined;
      notify();
    },
  };

  return {
    getSnapshot: () => {
      if (!cachedSnapshot) {
        cachedSnapshot = {
          ...(feedback ? { feedback } : {}),
          navigationRevision,
          downloadsInFlight,
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
      clearFeedbackTimer();
      feedback = undefined;
      for (const controller of inFlightControllers) {
        controller.abort();
      }
      inFlightControllers.clear();
      listeners.clear();
    },
  };
};

const isCancelled = (error: unknown): boolean =>
  error instanceof AlbumTransportError && error.code === "cancelled";
