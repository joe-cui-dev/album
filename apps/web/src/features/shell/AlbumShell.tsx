import type { ReactNode } from "react";
import { AlertTriangle, Archive, ChevronDown, Plus } from "lucide-react";
import { Link, useLocation } from "react-router";
import type { SessionUser } from "@album/shared";
import type { AlbumMutations } from "../album/albumMutations.js";
import { useAlbumMutationsSnapshot } from "../album/useAlbumMutations.js";
import type { ProcessingIssuesNavCount } from "../processing-issues/processingIssuesNavCount.js";
import { useProcessingIssuesNavCountSnapshot } from "../processing-issues/useProcessingIssuesNavCount.js";
import { UploadTrayPanel } from "../upload/UploadTrayPanel.js";
import type { UploadTray as UploadTrayModule } from "../upload/uploadTray.js";
import { uiMessages } from "../../lib/uiMessages.js";

interface AlbumShellProps {
  children: ReactNode;
  onSignedOut: () => void | Promise<void>;
  user: SessionUser;
  mutations: AlbumMutations;
  navCount: ProcessingIssuesNavCount;
  uploadTray: UploadTrayModule;
}

export function AlbumShell({ children, onSignedOut, user, mutations, navCount, uploadTray }: AlbumShellProps) {
  const { openCount } = useProcessingIssuesNavCountSnapshot(navCount);
  // The destination stays put while standing on it, even after the count drops to zero
  // mid-visit, and only disappears once the User navigates elsewhere (implementation doc
  // "Navigation count").
  const onProcessingIssuesView = useLocation().pathname === "/album/processing-issues";
  const showProcessingIssuesNav = onProcessingIssuesView || (openCount !== undefined && openCount > 0);

  return (
    <div className="album-shell">
      <header className="album-bar">
        <Link aria-label="Album home" className="album-wordmark" to="/album">
          {uiMessages.album}
        </Link>
        <nav aria-label={uiMessages.album} className="album-nav">
          <Link to="/album/archive">
            <Archive aria-hidden="true" size={16} />
            {uiMessages.archive}
          </Link>
          {showProcessingIssuesNav ? (
            <Link to="/album/processing-issues">
              <AlertTriangle aria-hidden="true" size={16} />
              {uiMessages.processingIssues.navLabel}
              {openCount ? ` (${openCount})` : ""}
            </Link>
          ) : null}
          <button className="album-add-button" onClick={uploadTray.intents.open} type="button">
            <Plus aria-hidden="true" size={17} />
            {uiMessages.addPhotos}
          </button>
        </nav>
        <details className="album-user-menu">
          <summary aria-label={`Account menu for ${user.email}`}>
            <span>{user.email}</span>
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          <button onClick={() => void onSignedOut()} type="button">{uiMessages.signOut}</button>
        </details>
      </header>
      {children}
      <FeedbackRegion mutations={mutations} />
      <UploadTrayPanel tray={uploadTray} />
    </div>
  );
}

/**
 * A single-slot, time-bound outcome region (implementation doc "Feedback region"):
 * success entries auto-dismiss on `albumMutations`' own timer, failures persist
 * until dismissed or retried, and the newest entry always replaces the last.
 */
function FeedbackRegion({ mutations }: { mutations: AlbumMutations }) {
  const snapshot = useAlbumMutationsSnapshot(mutations);
  const feedback = snapshot.feedback;

  return (
    <div aria-live="polite" className="album-feedback-region">
      {feedback ? (
        <div className={`album-feedback-entry album-feedback-entry--${feedback.kind}`} role="status">
          <span>{feedback.message}</span>
          {feedback.action ? (
            <button onClick={feedback.action.onInvoke} type="button">
              {feedback.action.label}
            </button>
          ) : null}
          <button
            aria-label="Dismiss"
            onClick={mutations.intents.dismissFeedback}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
