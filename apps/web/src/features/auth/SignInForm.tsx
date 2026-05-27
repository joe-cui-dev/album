import { FormEvent, useState } from "react";
import type { SessionUser } from "@album/shared";
import { apiClient } from "../../lib/apiClient.js";

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
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send code");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!codeId) {
      setError("Request a sign-in code first");
      return;
    }

    setSubmitting(true);
    setError(undefined);
    try {
      const response = await apiClient.verifySignInCode({ email, codeId, code });
      onSignedIn(response.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto grid min-h-screen max-w-md content-center px-5 py-10">
      <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase text-emerald-700">
          Personal Album
        </p>
        <h1 className="mt-2 text-3xl font-bold text-stone-950">Sign in</h1>
        <form className="mt-6 space-y-4" onSubmit={codeId ? verifyCode : requestCode}>
          <label className="block text-sm font-semibold text-stone-800">
            Email address
            <input
              className="mt-2 block min-h-11 w-full rounded-md border border-stone-300 px-3 text-base"
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          {codeId ? (
            <label className="block text-sm font-semibold text-stone-800">
              Sign-in code
              <input
                className="mt-2 block min-h-11 w-full rounded-md border border-stone-300 px-3 text-base"
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
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Development code: <span className="font-mono">{devCode}</span>
            </p>
          ) : null}

          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}

          <button
            className="min-h-11 w-full justify-center rounded-md bg-emerald-800 px-4 font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
            disabled={submitting}
            type="submit"
          >
            {codeId ? "Verify code" : "Send sign-in code"}
          </button>
        </form>
      </div>
    </section>
  );
}
