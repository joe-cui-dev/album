/**
 * One Sign-In Challenge record per normalised Email Address (ADR-0071). A consumed
 * (signed-in) Challenge is marked `consumed`, not deleted -- a message redelivered after its
 * Code was already used to sign in must never re-arm that Code, so the record's `requestId`
 * has to survive long enough for `tryDispatch` to recognise it. `recordAttempt` treats a
 * consumed record as inactive.
 *
 * `codeExpiresAt` is the Code's verification deadline (normally ten minutes); `expiresAt` is
 * the separate DynamoDB TTL retention deadline, kept for at least the rolling one-hour
 * rate-limit window so the five-per-hour send limit can still be enforced after the Code
 * itself has expired.
 */
export interface SignInChallenge {
  email: string;
  /** The dispatch message's request identity -- lets a redelivered message recognise its own Challenge. */
  requestId: string;
  codeHash: string;
  createdAt: string;
  codeExpiresAt: number;
  expiresAt: number;
  wrongAttempts: number;
  lastSentAt: number;
  /** Epoch-second sends within the trailing rolling hour, for the 5-per-hour limit. */
  sendTimestamps: number[];
  consumed: boolean;
}

export interface DispatchOutcome {
  /** False when a real (non-redelivery) request was silently rate-limited, or when a
   * redelivery arrived after its Challenge was consumed or its Code had already expired. */
  dispatched: boolean;
}

export type AttemptOutcome = "consumed" | "wrong" | "no_active_challenge" | "expired" | "exhausted";

export const MAX_WRONG_ATTEMPTS = 5;
export const RATE_LIMIT_COOLDOWN_SECONDS = 60;
export const RATE_LIMIT_MAX_PER_HOUR = 5;
export const RATE_LIMIT_WINDOW_SECONDS = 3600;

export interface SignInChallengeStore {
  /**
   * Atomically installs a new active Challenge for `email`, unless: this exact `requestId`
   * is already the active (not consumed, not Code-expired) Challenge -- an at-least-once
   * redelivery, same result, no rate slot consumed; this exact `requestId` was already
   * consumed or its Code has since expired -- a redelivery that must not resend or re-arm
   * the Code; or the cooldown/rolling-hour limit is exceeded -- a silent no-op.
   */
  tryDispatch(input: {
    email: string;
    requestId: string;
    codeHash: string;
    now: Date;
    codeTtlSeconds: number;
  }): Promise<DispatchOutcome>;

  /**
   * Atomically evaluates `candidateHash` against the active Challenge: marks it consumed
   * on a match so concurrent correct guesses have exactly one winner and the Code can never
   * verify again, or increments `wrongAttempts` (capped) on a mismatch. Uses `codeExpiresAt`,
   * not the record's DynamoDB TTL, to decide whether the Code is still verifiable.
   */
  recordAttempt(input: { email: string; candidateHash: string; now: Date }): Promise<AttemptOutcome>;
}
