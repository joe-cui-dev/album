import { ReactNode, useEffect, useState } from "react";
import type { SessionUser } from "@album/shared";
import { apiClient } from "../../lib/apiClient.js";
import { SignInForm } from "./SignInForm.js";

interface AuthGateProps {
  children: (props: {
    user: SessionUser;
    onSignedOut: () => void;
  }) => ReactNode;
}

type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: SessionUser }
  | { status: "error"; message: string };

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    apiClient
      .getSession()
      .then((response) => {
        if (!active) {
          return;
        }
        setSession(
          response.signedIn && response.user
            ? { status: "signedIn", user: response.user }
            : { status: "signedOut" },
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setSession({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load session",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  if (session.status === "loading") {
    return <main className="grid min-h-screen place-items-center">Loading session</main>;
  }

  if (session.status === "error") {
    return (
      <main className="grid min-h-screen place-items-center px-5 text-red-700">
        {session.message}
      </main>
    );
  }

  if (session.status === "signedOut") {
    return (
      <SignInForm
        onSignedIn={(user) => setSession({ status: "signedIn", user })}
      />
    );
  }

  return children({
    user: session.user,
    onSignedOut: () => setSession({ status: "signedOut" }),
  });
}
