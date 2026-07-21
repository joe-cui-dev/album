import type { ReactNode } from "react";
import { Archive, ChevronDown, Plus } from "lucide-react";
import { Link } from "react-router";
import type { SessionUser } from "@album/shared";
import type { AlbumMutations } from "../album/albumMutations.js";
import { useAlbumMutationsSnapshot } from "../album/useAlbumMutations.js";
import { uiMessages } from "../../lib/uiMessages.js";

interface AlbumShellProps {
  children: ReactNode;
  onSignedOut: () => void | Promise<void>;
  user: SessionUser;
  mutations: AlbumMutations;
}

export function AlbumShell({ children, onSignedOut, user, mutations }: AlbumShellProps) {
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
          <Link className="album-add-button" to="/album/upload">
            <Plus aria-hidden="true" size={17} />
            {uiMessages.addPhotos}
          </Link>
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
