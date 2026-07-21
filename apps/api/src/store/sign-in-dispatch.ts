/**
 * One Sign-In Code credential record per normalised Email Address (execution plan Slice
 * 1.4). Consumed (signed-in) credentials are marked `consumed`, not deleted -- a message
 * redelivered after its Code was already used to sign in must never re-arm that Code, so
 * the record's `requestId` has to survive long enough for `tryDispatch` to recognise it.
 * `getActiveCredential` and `recordAttempt` both treat a consumed record as inactive.
 */
export interface ActiveSignInCredential {
  email: string;
  /** The dispatch message's request identity -- lets a redelivered message recognise its own credential. */
  requestId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: number;
  wrongAttempts: number;
  lastSentAt: number;
  /** Epoch-second sends within the trailing rolling hour, for the 5-per-hour limit. */
  sendTimestamps: number[];
  consumed: boolean;
}

export interface DispatchOutcome {
  /** False when a real (non-redelivery) request was silently rate-limited. */
  dispatched: boolean;
}

export type AttemptOutcome = "consumed" | "wrong" | "no_active_credential" | "expired" | "exhausted";

export const MAX_WRONG_ATTEMPTS = 5;
export const RATE_LIMIT_COOLDOWN_SECONDS = 60;
export const RATE_LIMIT_MAX_PER_HOUR = 5;
export const RATE_LIMIT_WINDOW_SECONDS = 3600;

export interface SignInDispatchStore {
  /**
   * Atomically installs a new active credential for `email`, unless: this exact `requestId`
   * is already the active (not yet consumed) credential -- an at-least-once redelivery, same
   * result, no rate slot consumed; this exact `requestId` was already consumed -- a
   * redelivery arriving after a successful sign-in, which must not resend or re-arm the
   * Code; or the cooldown/rolling-hour limit is exceeded -- a silent no-op.
   */
  tryDispatch(input: {
    email: string;
    requestId: string;
    codeHash: string;
    now: Date;
    codeTtlSeconds: number;
  }): Promise<DispatchOutcome>;

  /** Looks up the single active (not consumed, not expired) credential by normalised Email
   * Address -- never by a public code ID. */
  getActiveCredential(email: string): Promise<ActiveSignInCredential | undefined>;

  /**
   * Atomically evaluates `candidateHash` against the active credential: marks it consumed
   * on a match so concurrent correct guesses have exactly one winner and the Code can never
   * verify again, or increments `wrongAttempts` (capped) on a mismatch.
   */
  recordAttempt(input: { email: string; candidateHash: string; now: Date }): Promise<AttemptOutcome>;
}
