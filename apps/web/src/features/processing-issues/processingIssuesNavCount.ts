import type { ProcessingIssuesPort } from "./processingIssuesPort.js";

export interface ProcessingIssuesNavCountSnapshot {
  /** `undefined` until the first summary fetch resolves. */
  openCount: number | undefined;
}

export interface ProcessingIssuesNavCountIntents {
  /** Re-fetches the summary. Called once at album load, and again whenever the client observes an event that could have moved the count (implementation doc "Navigation count"). */
  refresh(): void;
}

export interface ProcessingIssuesNavCount {
  getSnapshot(): ProcessingIssuesNavCountSnapshot;
  subscribe(listener: () => void): () => void;
  intents: ProcessingIssuesNavCountIntents;
  dispose(): void;
}

export interface ProcessingIssuesNavCountOptions {
  port: Pick<ProcessingIssuesPort, "getSummary">;
}

/**
 * Client-held, event-driven mirror of the open Processing Issues count
 * (implementation doc "Navigation count"). It is deliberately not a live
 * server mirror: it is inert until `intents.refresh()` is called -- once at
 * album load, then again on the events the client already owns -- so the
 * conditional nav entry never disappears out from under a User who is still
 * standing on the Processing Issues view.
 */
export const createProcessingIssuesNavCount = (options: ProcessingIssuesNavCountOptions): ProcessingIssuesNavCount => {
  const { port } = options;

  let disposed = false;
  const listeners = new Set<() => void>();
  const inFlightControllers = new Set<AbortController>();

  let openCount: number | undefined;
  let cachedSnapshot: ProcessingIssuesNavCountSnapshot | undefined;

  const notify = (): void => {
    cachedSnapshot = undefined;
    for (const listener of listeners) {
      listener();
    }
  };

  const refresh = (): void => {
    if (disposed) {
      return;
    }
    const controller = new AbortController();
    inFlightControllers.add(controller);
    void port
      .getSummary({ signal: controller.signal })
      .then((response) => {
        if (disposed) {
          return;
        }
        openCount = response.openCount;
        notify();
      })
      .catch(() => {
        // The nav entry is a convenience affordance, not a source of truth; a failed
        // refresh simply leaves the last-known count in place until the next event.
      })
      .finally(() => {
        inFlightControllers.delete(controller);
      });
  };

  return {
    getSnapshot: () => {
      if (!cachedSnapshot) {
        cachedSnapshot = { openCount };
      }
      return cachedSnapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    intents: { refresh },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const controller of inFlightControllers) {
        controller.abort();
      }
      inFlightControllers.clear();
      listeners.clear();
    },
  };
};
