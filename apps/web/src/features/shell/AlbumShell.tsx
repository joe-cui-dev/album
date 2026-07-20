import type { ReactNode } from "react";
import { Archive, ChevronDown, Plus } from "lucide-react";
import { Link } from "react-router";
import type { SessionUser } from "@album/shared";
import { uiMessages } from "../../lib/uiMessages.js";

interface AlbumShellProps {
  children: ReactNode;
  onSignedOut: () => void | Promise<void>;
  user: SessionUser;
}

export function AlbumShell({ children, onSignedOut, user }: AlbumShellProps) {
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
    </div>
  );
}
