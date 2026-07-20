import { useEffect, useRef } from "react";
import {
  Link,
  Route,
  Routes,
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLocation,
} from "react-router";
import type { SessionUser } from "@album/shared";
import { createBrowsingHistoryRegistry, type BrowsingHistoryRegistry } from "./features/browsing/browsingHistoryRegistry.js";
import { BrowsingPage } from "./features/browsing/BrowsingPage.js";
import { AuthGate } from "./features/auth/AuthGate.js";
import { ALBUM_BACKGROUND_ROOT_ID } from "./features/shell/albumBackgroundRoot.js";
import { AlbumShell } from "./features/shell/AlbumShell.js";
import { ManualUploadWorkspace } from "./features/upload/ManualUploadWorkspace.js";
import { PhotoViewerRoute } from "./features/viewer/PhotoViewerRoute.js";
import { apiClient } from "./lib/apiClient.js";
import { sessionExpiredEvent } from "./lib/sessionEvents.js";
import { uiMessages } from "./lib/uiMessages.js";

export function App() {
  return (
    <AuthGate>
      {({ user, onSignedOut }) => (
        // A fresh key per signed-in user guarantees fresh controllers even for the same Email Address (ADR-0062).
        <AlbumRoot key={user.userId} onSignedOut={onSignedOut} user={user} />
      )}
    </AuthGate>
  );
}

interface AlbumRootProps {
  onSignedOut: () => void;
  user: SessionUser;
}

function AlbumRoot({ onSignedOut, user }: AlbumRootProps) {
  const registryRef = useRef<BrowsingHistoryRegistry | undefined>(undefined);
  if (!registryRef.current) {
    registryRef.current = createBrowsingHistoryRegistry();
  }

  const routerRef = useRef<ReturnType<typeof createBrowserRouter> | undefined>(undefined);
  if (!routerRef.current) {
    routerRef.current = createBrowserRouter([
      {
        path: "/album/*",
        element: (
          <AlbumShell
            onSignedOut={() => void handleSignOut({ registry: registryRef.current!, onSignedOut })}
            user={user}
          >
            <AlbumRoutes registry={registryRef.current} />
          </AlbumShell>
        ),
      },
      { path: "/", element: <Navigate replace to="/album" /> },
      { path: "*", element: <Navigate replace to="/album" /> },
    ]);
  }

  useEffect(() => {
    // Session expiry disposes private state in place and preserves the current URL; explicit Sign Out (above) also navigates away (ADR-0062).
    const disposeOnSessionLoss = () => registryRef.current?.disposeAll();
    window.addEventListener(sessionExpiredEvent, disposeOnSessionLoss);
    return () => window.removeEventListener(sessionExpiredEvent, disposeOnSessionLoss);
  }, []);

  useEffect(() => () => registryRef.current?.disposeAll(), []);

  return <RouterProvider router={routerRef.current} />;
}

interface AlbumRoutesProps {
  registry: BrowsingHistoryRegistry;
}

/**
 * A contextual Photo Viewer keeps the originating Timeline/Archive route
 * mounted underneath it (ADR-0063): the background-aware `<Routes>` renders
 * at `state.background` while a second overlay `<Routes>` matches the real
 * location for the modal. A direct load or refresh carries no background
 * state, so the first block renders the Viewer itself as an ordinary page.
 */
function AlbumRoutes({ registry }: AlbumRoutesProps) {
  const location = useLocation();
  const state = location.state as { background?: Location } | null;
  const backgroundLocation = state?.background;

  return (
    <>
      <div id={ALBUM_BACKGROUND_ROOT_ID}>
        <Routes location={backgroundLocation ?? location}>
          <Route
            element={
              <BrowsingPage
                collection="active"
                emptyState={{
                  title: uiMessages.emptyAlbum.title,
                  description: uiMessages.emptyAlbum.description,
                  action: (
                    <>
                      <Link
                        className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 font-bold text-white"
                        to="/album/upload"
                      >
                        {uiMessages.addPhotos}
                      </Link>
                      <small>{uiMessages.emptyAlbum.formats}</small>
                    </>
                  ),
                }}
                registry={registry}
                title={uiMessages.album}
              />
            }
            index
          />
          <Route
            element={
              <BrowsingPage
                collection="archived"
                emptyState={{ title: uiMessages.emptyArchive.title, description: uiMessages.emptyArchive.description }}
                registry={registry}
                title={uiMessages.archive}
              />
            }
            path="archive"
          />
          <Route element={<ManualUploadWorkspace />} path="upload" />
          <Route element={<PhotoViewerRoute mode="direct" />} path="photos/:photoId" />
        </Routes>
      </div>
      {backgroundLocation ? (
        <Routes>
          <Route element={<PhotoViewerRoute mode="contextual" />} path="photos/:photoId" />
        </Routes>
      ) : null}
    </>
  );
}

const handleSignOut = async ({
  registry,
  onSignedOut,
}: {
  registry: BrowsingHistoryRegistry;
  onSignedOut: () => void;
}): Promise<void> => {
  try {
    await apiClient.signOut();
  } finally {
    registry.disposeAll();
    // The whole router unmounts right after (AuthGate flips to signed-out), so this sets the
    // generic entry URL directly rather than routing through it (ADR-0062).
    window.history.replaceState({}, "", "/");
    onSignedOut();
  }
};
