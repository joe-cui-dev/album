import { useEffect, useRef } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router";
import type { SessionUser } from "@album/shared";
import { createBrowsingHistoryRegistry, type BrowsingHistoryRegistry } from "./features/browsing/browsingHistoryRegistry.js";
import { AuthGate } from "./features/auth/AuthGate.js";
import { AlbumShell } from "./features/shell/AlbumShell.js";
import { ManualUploadWorkspace } from "./features/upload/ManualUploadWorkspace.js";
import { UploadPage } from "./features/upload/UploadPage.js";
import { apiClient } from "./lib/apiClient.js";
import { sessionExpiredEvent } from "./lib/sessionEvents.js";

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
        path: "/album",
        element: (
          <AlbumShell
            onSignedOut={() => void handleSignOut({ registry: registryRef.current!, onSignedOut })}
            user={user}
          >
            <Outlet />
          </AlbumShell>
        ),
        children: [
          { index: true, element: <UploadPage destination="timeline" /> },
          { path: "archive", element: <UploadPage destination="archive" /> },
          { path: "upload", element: <ManualUploadWorkspace /> },
        ],
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
