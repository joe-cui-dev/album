import { AuthGate } from "./features/auth/AuthGate.js";
import { UploadPage } from "./features/upload/UploadPage.js";

export function App() {
  return (
    <AuthGate>
      {({ user, onSignedOut }) => (
        <UploadPage onSignedOut={onSignedOut} user={user} />
      )}
    </AuthGate>
  );
}
