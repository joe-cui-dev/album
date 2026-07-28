import { useEffect, useRef, useState } from "react";
import type { ProcessingIssue } from "@album/shared";
import type { AlbumMutations } from "../album/albumMutations.js";
import { PermanentDeletionDialog } from "../album/PermanentDeletionDialog.js";
import { useAlbumMutationsSnapshot } from "../album/useAlbumMutations.js";
import { uiMessages } from "../../lib/uiMessages.js";
import type { ProcessingIssuesNavCount } from "./processingIssuesNavCount.js";
import { createHttpProcessingIssuesPort, type ProcessingIssuesPort } from "./processingIssuesPort.js";
import { messageForReasonCode } from "./reasonMessage.js";

interface ProcessingIssuesViewProps {
  mutations: AlbumMutations;
  navCount: ProcessingIssuesNavCount;
}

const POLL_INTERVAL_MS = 2_000;

/**
 * `/album/processing-issues` (implementation doc "Processing Issues"). The
 * list is durable and cursor-paginated server-side, but this view walks
 * every page on each load/poll and renders the whole open set -- Processing
 * Issue counts are small enough that a "load more" affordance would add UI
 * complexity the design never asks for.
 */
export function ProcessingIssuesView({ mutations, navCount }: ProcessingIssuesViewProps) {
  const portRef = useRef<ProcessingIssuesPort>(createHttpProcessingIssuesPort());
  const [issues, setIssues] = useState<ProcessingIssue[]>();
  const [loadError, setLoadError] = useState<string>();
  const [pendingRetryIds, setPendingRetryIds] = useState<ReadonlySet<string>>(new Set());
  const [abandonPhotoId, setAbandonPhotoId] = useState<string>();
  const previousOpenCountRef = useRef<number | undefined>(undefined);
  const mutationsSnapshot = useAlbumMutationsSnapshot(mutations);

  const loadAll = async (signal: AbortSignal): Promise<void> => {
    try {
      const collected: ProcessingIssue[] = [];
      let cursor: string | undefined;
      do {
        const page = await portRef.current.listIssues({ ...(cursor !== undefined ? { cursor } : {}), signal });
        collected.push(...page.issues);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      if (signal.aborted) {
        return;
      }
      setIssues(collected);
      setLoadError(undefined);
      setPendingRetryIds((current) => {
        const next = new Set(current);
        for (const photoId of current) {
          const issue = collected.find((candidate) => candidate.photoId === photoId);
          if (!issue || issue.status === "retrying") {
            next.delete(photoId);
          }
        }
        return next;
      });
      if (previousOpenCountRef.current !== undefined && collected.length < previousOpenCountRef.current) {
        // A Retry (or Upload Batch reprocessing) resolved an issue since the last look (implementation doc "Navigation count").
        navCount.intents.refresh();
      }
      previousOpenCountRef.current = collected.length;
    } catch {
      if (signal.aborted) {
        return;
      }
      setLoadError(uiMessages.processingIssues.loadFailed);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    navCount.intents.refresh();
    void loadAll(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAll reads no reactive state, only stable refs; navigationRevision is the intentional re-fetch trigger (e.g. a successful Abandon Photo).
  }, [mutationsSnapshot.navigationRevision]);

  const isRetrying = (issue: ProcessingIssue): boolean => issue.status === "retrying" || pendingRetryIds.has(issue.photoId);
  const anyRetrying = (issues ?? []).some(isRetrying);

  useEffect(() => {
    if (!anyRetrying) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      const controller = new AbortController();
      void loadAll(controller.signal);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAll reads no reactive state, only stable refs.
  }, [anyRetrying]);

  const retry = (photoId: string): void => {
    setPendingRetryIds((current) => new Set(current).add(photoId));
    mutations.intents.retryProcessing(photoId);
  };

  const confirmAbandon = (): void => {
    if (!abandonPhotoId) {
      return;
    }
    mutations.intents.abandonPhoto(abandonPhotoId);
    setAbandonPhotoId(undefined);
  };

  return (
    <main className="album-content">
      <h1>{uiMessages.processingIssues.title}</h1>

      {loadError ? (
        <p className="mt-4 rounded-md border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" role="alert">
          {loadError}
        </p>
      ) : null}

      {issues === undefined ? null : issues.length === 0 ? (
        <div className="prismatic-status-surface mt-8 p-6 text-center">
          <p className="font-semibold text-ink">{uiMessages.processingIssues.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-muted">{uiMessages.processingIssues.emptyDescription}</p>
        </div>
      ) : (
        <ul className="prismatic-status-surface mt-6 divide-y divide-line">
          {issues.map((issue) => (
            <ProcessingIssueRow
              isRetrying={isRetrying(issue)}
              issue={issue}
              key={issue.photoId}
              onAbandon={setAbandonPhotoId}
              onRetry={retry}
            />
          ))}
        </ul>
      )}

      {abandonPhotoId ? (
        <PermanentDeletionDialog
          onCancel={() => setAbandonPhotoId(undefined)}
          onConfirm={confirmAbandon}
          target="abandon"
        />
      ) : null}
    </main>
  );
}

function ProcessingIssueRow({
  issue,
  isRetrying,
  onAbandon,
  onRetry,
}: {
  issue: ProcessingIssue;
  isRetrying: boolean;
  onAbandon: (photoId: string) => void;
  onRetry: (photoId: string) => void;
}) {
  return (
    <li className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="font-semibold text-ink">{issue.fileName}</p>
        <p className="mt-1 text-sm text-ink-muted">{messageForReasonCode(issue.reasonCode)}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {uiMessages.processingIssues.addedAt} {new Date(issue.addedAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex gap-2 sm:justify-end">
        <button
          className="prismatic-secondary-action text-danger disabled:cursor-not-allowed disabled:text-ink-muted/50"
          disabled={isRetrying}
          onClick={() => onAbandon(issue.photoId)}
          type="button"
        >
          {uiMessages.processingIssues.abandon}
        </button>
        <button
          className="prismatic-secondary-action disabled:cursor-not-allowed disabled:text-ink-muted/50"
          disabled={isRetrying}
          onClick={() => onRetry(issue.photoId)}
          type="button"
        >
          {isRetrying ? uiMessages.processingIssues.retrying : uiMessages.processingIssues.retry}
        </button>
      </div>
    </li>
  );
}
