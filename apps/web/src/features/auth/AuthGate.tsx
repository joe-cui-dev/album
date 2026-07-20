import { ReactNode, useEffect, useState } from "react";
import type { SessionUser } from "@album/shared";
import { apiClient, sessionExpiredEvent } from "../../lib/apiClient.js";
import { uiMessages } from "../../lib/uiMessages.js";
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

  useEffect(() => {
    const returnToSignIn = () => setSession({ status: "signedOut" });
    window.addEventListener(sessionExpiredEvent, returnToSignIn);
    return () => window.removeEventListener(sessionExpiredEvent, returnToSignIn);
  }, []);

  if (session.status === "loading") {
    return (
      <main className="session-state" aria-live="polite">
        <span aria-hidden="true" className="session-mark">A</span>
        <p>{uiMessages.session.loading}</p>
      </main>
    );
  }

  if (session.status === "error") {
    return (
      <main className="session-state px-5">
        <section className="session-error" role="alert">
          <span aria-hidden="true" className="session-mark">A</span>
          <h1>{uiMessages.session.failed}</h1>
          <p>{session.message}</p>
          <button onClick={() => setSession({ status: "signedOut" })} type="button">
            {uiMessages.session.returnToSignIn}
          </button>
        </section>
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
