import { AuthGate } from "./features/auth/AuthGate.js";
import { AlbumShell } from "./features/shell/AlbumShell.js";
import { UploadPage } from "./features/upload/UploadPage.js";
import { apiClient } from "./lib/apiClient.js";

export function App() {
  const isArchiveRoute = window.location.pathname === "/album/archive";
  const openPhotoFilePicker = () => document.getElementById("photo-file-input")?.click();

  return (
    <AuthGate>
      {({ user, onSignedOut }) => (
        <AlbumShell
          onAddPhotos={openPhotoFilePicker}
          onSignedOut={async () => {
            try {
              await apiClient.signOut();
            } finally {
              onSignedOut();
            }
          }}
          user={user}
        >
          <UploadPage
            destination={isArchiveRoute ? "archive" : "timeline"}
            onAddPhotos={openPhotoFilePicker}
          />
        </AlbumShell>
      )}
    </AuthGate>
  );
}
