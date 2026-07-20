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
  const [codeId, setCodeId] = useState<string>();
  const [devCode, setDevCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await apiClient.requestSignInCode({ email });
      setCodeId(response.codeId);
      setDevCode(response.devCode);
    } catch {
      setError(uiMessages.signIn.sendCodeFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!codeId) {
      setError(uiMessages.signIn.requestCodeFirst);
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const response = await apiClient.verifySignInCode({ email, codeId, code });
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
        <form onSubmit={codeId ? verifyCode : requestCode}>
          <label>
            {uiMessages.signIn.email}
            <input
              autoComplete="email"
              disabled={Boolean(codeId)}
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          {codeId ? (
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

          {devCode ? (
            <p className="development-code">
              Development code: <span className="font-mono">{devCode}</span>
            </p>
          ) : null}

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <button
            disabled={submitting}
            type="submit"
          >
            {codeId ? uiMessages.signIn.verifyCode : uiMessages.signIn.requestCode}
          </button>
        </form>
        {codeId ? (
          <button className="text-button" onClick={() => setCodeId(undefined)} type="button">
            {uiMessages.signIn.useDifferentEmail}
          </button>
        ) : null}
      </section>
    </main>
  );
}
