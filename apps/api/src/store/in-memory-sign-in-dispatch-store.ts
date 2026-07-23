import { safeEqual } from "../sign-in-code-crypto.js";
import type { ActiveSignInCredential, AttemptOutcome, SignInDispatchStore } from "./sign-in-dispatch.js";
import { MAX_WRONG_ATTEMPTS, RATE_LIMIT_COOLDOWN_SECONDS, RATE_LIMIT_MAX_PER_HOUR, RATE_LIMIT_WINDOW_SECONDS } from "./sign-in-dispatch.js";

/** No `await` appears between reading and writing `records` in any method below, so each
 * call runs to completion in one microtask -- concurrent callers can't interleave. */
export const createInMemorySignInDispatchStore = (): SignInDispatchStore => {
  const records = new Map<string, ActiveSignInCredential>();

  return {
    async tryDispatch({ email, requestId, codeHash, now, codeTtlSeconds }) {
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const existing = records.get(email);

      if (existing?.requestId === requestId) {
        // A redelivery of the same message: resend the identical Code if it's still active,
        // but never resurrect one that already signed someone in.
        return { dispatched: !existing.consumed };
      }

      if (existing) {
        if (nowSeconds - existing.lastSentAt < RATE_LIMIT_COOLDOWN_SECONDS) {
          return { dispatched: false };
        }
        const withinWindow = existing.sendTimestamps.filter((sentAt) => nowSeconds - sentAt < RATE_LIMIT_WINDOW_SECONDS);
        if (withinWindow.length >= RATE_LIMIT_MAX_PER_HOUR) {
          return { dispatched: false };
        }
        records.set(email, {
          email,
          requestId,
          codeHash,
          createdAt: now.toISOString(),
          expiresAt: nowSeconds + codeTtlSeconds,
          wrongAttempts: 0,
          lastSentAt: nowSeconds,
          sendTimestamps: [...withinWindow, nowSeconds],
          consumed: false,
        });
        return { dispatched: true };
      }

      records.set(email, {
        email,
        requestId,
        codeHash,
        createdAt: now.toISOString(),
        expiresAt: nowSeconds + codeTtlSeconds,
        wrongAttempts: 0,
        lastSentAt: nowSeconds,
        sendTimestamps: [nowSeconds],
        consumed: false,
      });
      return { dispatched: true };
    },

    async getActiveCredential(email) {
      const existing = records.get(email);
      return existing && !existing.consumed ? existing : undefined;
    },

    async recordAttempt({ email, candidateHash, now }): Promise<AttemptOutcome> {
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const existing = records.get(email);
      if (!existing || existing.consumed) return "no_active_credential";
      if (existing.expiresAt <= nowSeconds) return "expired";
      if (existing.wrongAttempts >= MAX_WRONG_ATTEMPTS) return "exhausted";

      if (safeEqual(existing.codeHash, candidateHash)) {
        existing.consumed = true;
        return "consumed";
      }

      existing.wrongAttempts += 1;
      return "wrong";
    },
  };
};
