import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, ChevronDown, Images, Plus } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";
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

  // Drives the sticky app bar's scroll-divider shadow (design doc "Photographic Signature"):
  // a static class flip, not an animation, so it needs no reduced-motion branch -- the
  // box-shadow's own CSS transition already falls under the global reduced-motion override.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="album-shell">
      <header className={`album-bar ${scrolled ? "album-bar--scrolled" : ""}`}>
        <Link aria-label="Album home" className="album-wordmark" to="/album">
          {uiMessages.album}
        </Link>
        <nav aria-label={uiMessages.album} className="album-nav album-nav--desktop">
          <NavLink end to="/album"><Images aria-hidden="true" size={16} />{uiMessages.album}</NavLink>
          <NavLink to="/album/archive">
            <Archive aria-hidden="true" size={16} />
            {uiMessages.archive}
          </NavLink>
          {showProcessingIssuesNav ? (
            <NavLink to="/album/processing-issues">
              <AlertTriangle aria-hidden="true" size={16} />
              {uiMessages.processingIssues.navLabel}
              {openCount ? ` (${openCount})` : ""}
            </NavLink>
          ) : null}
          <button
            className="album-add-button"
            id="album-add-photos-button"
            onClick={uploadTray.intents.open}
            type="button"
          >
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
      <nav aria-label="Album destinations" className="album-dock">
        <NavLink end to="/album"><Images aria-hidden="true" size={18} /><span>{uiMessages.album}</span></NavLink>
        <NavLink to="/album/archive"><Archive aria-hidden="true" size={18} /><span>{uiMessages.archive}</span></NavLink>
        <button onClick={uploadTray.intents.open} type="button"><Plus aria-hidden="true" size={20} /><span>{uiMessages.addPhotos}</span></button>
        {showProcessingIssuesNav ? <NavLink to="/album/processing-issues"><AlertTriangle aria-hidden="true" size={18} /><span>{uiMessages.processingIssues.navLabel}</span></NavLink> : null}
      </nav>
      <FeedbackRegion mutations={mutations} />
      <UploadTrayPanel tray={uploadTray} />
    </div>
  );
}

/**
 * A single-slot, time-bound outcome region (implementation doc "Feedback region"):
 * success-without-action entries auto-dismiss on `albumMutations`' own timer, failures
 * and action-bearing successes (Undo/Retry) persist until acted on, dismissed, or
 * replaced, and the newest entry always replaces the last. Success and failure each get
 * their own statically-live-region container so their politeness (`polite`/`assertive`)
 * is fixed, not toggled -- screen readers pick up dynamic `aria-live` values inconsistently.
 */
function FeedbackRegion({ mutations }: { mutations: AlbumMutations }) {
  const snapshot = useAlbumMutationsSnapshot(mutations);
  const feedback = snapshot.feedback;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hadFocusRef = useRef(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const onFocusIn = () => {
      hadFocusRef.current = true;
    };
    wrapper.addEventListener("focusin", onFocusIn);
    return () => wrapper.removeEventListener("focusin", onFocusIn);
  }, []);

  // If focus was inside the region when the entry it belonged to was replaced (e.g. Undo
  // publishing the reversing entry), move focus onto the new entry's primary control
  // instead of letting it fall back to <body>.
  useLayoutEffect(() => {
    if (hadFocusRef.current) {
      hadFocusRef.current = false;
      primaryRef.current?.focus();
    }
  }, [feedback?.id]);

  const entry = feedback ? (
    <div className={`album-feedback-entry album-feedback-entry--${feedback.kind}`}>
      <span>{feedback.message}</span>
      {feedback.action ? (
        <button onClick={feedback.action.onInvoke} ref={primaryRef} type="button">
          {feedback.action.label}
        </button>
      ) : null}
      <button
        aria-label="Dismiss"
        onClick={mutations.intents.dismissFeedback}
        ref={feedback.action ? undefined : primaryRef}
        type="button"
      >
        Dismiss
      </button>
    </div>
  ) : null;

  return (
    <div ref={wrapperRef}>
      <div aria-live="polite" className="album-feedback-region">
        {feedback?.kind === "success" ? <div role="status">{entry}</div> : null}
      </div>
      <div aria-live="assertive" className="album-feedback-region">
        {feedback?.kind === "failure" ? <div role="alert">{entry}</div> : null}
      </div>
    </div>
  );
}
