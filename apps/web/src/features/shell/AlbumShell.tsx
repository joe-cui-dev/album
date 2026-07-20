import type { ReactNode } from "react";
import { Archive, ChevronDown, Plus } from "lucide-react";
import type { SessionUser } from "@album/shared";
import { uiMessages } from "../../lib/uiMessages.js";

interface AlbumShellProps {
  children: ReactNode;
  onAddPhotos: () => void;
  onSignedOut: () => void | Promise<void>;
  user: SessionUser;
}

export function AlbumShell({ children, onAddPhotos, onSignedOut, user }: AlbumShellProps) {
  return (
    <div className="album-shell">
      <header className="album-bar">
        <a aria-label="Album home" className="album-wordmark" href="/album">
          {uiMessages.album}
        </a>
        <nav aria-label={uiMessages.album} className="album-nav">
          <a href="/album/archive">
            <Archive aria-hidden="true" size={16} />
            {uiMessages.archive}
          </a>
          <button className="album-add-button" onClick={onAddPhotos} type="button">
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
    </div>
  );
}
