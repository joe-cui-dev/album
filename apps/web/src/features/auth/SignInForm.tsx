import { FormEvent, useState } from "react";
import type { SessionUser } from "@album/shared";
import { apiClient } from "../../lib/apiClient.js";
import { uiMessages } from "../../lib/uiMessages.js";

interface SignInFormProps {
  onSignedIn: (user: SessionUser) => void;
}

export function SignInForm({ onSignedIn }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // The canonical Sign-In Challenge has no public code ID (ADR-0071): the Email the code
  // was requested for is the only context carried into verification.
  const [codeRequestedFor, setCodeRequestedFor] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await apiClient.requestSignInCode({ email });
      setCodeRequestedFor(email);
    } catch {
      setError(uiMessages.signIn.sendCodeFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await apiClient.verifySignInCode({ email: codeRequestedFor ?? email, code });
      onSignedIn(response.user);
    } catch {
      setError(uiMessages.signIn.verifyCodeFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="sign-in-page">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <p className="wordmark">{uiMessages.album}</p>
        <h1 id="sign-in-title">{uiMessages.signIn.title}</h1>
        <p className="sign-in-intro">{uiMessages.signIn.description}</p>
        <form onSubmit={codeRequestedFor ? verifyCode : requestCode}>
          <label>
            {uiMessages.signIn.email}
            <input
              autoComplete="email"
              disabled={Boolean(codeRequestedFor)}
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          {codeRequestedFor ? (
            <label>
              {uiMessages.signIn.code}
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                name="code"
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
          ) : null}

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <button
            disabled={submitting}
            type="submit"
          >
            {codeRequestedFor ? uiMessages.signIn.verifyCode : uiMessages.signIn.requestCode}
          </button>
        </form>
        {codeRequestedFor ? (
          <button className="text-button" onClick={() => setCodeRequestedFor(undefined)} type="button">
            {uiMessages.signIn.useDifferentEmail}
          </button>
        ) : null}
      </section>
    </main>
  );
}
