import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

/**
 * Auth v2's Sign-In Code is retry-stable (execution plan Slice 1.4): derived from secret
 * material plus the dispatch message's request identity, never from randomness or storage.
 * A redelivered message reproduces the identical Code without needing to read anything back.
 */
export const deriveSignInCode = (requestId: string): string => {
  const digest = createHmac("sha256", config.sessionSigningSecret).update(requestId).digest();
  const sixDigits = digest.readUInt32BE(0) % 900_000;
  return String(100_000 + sixDigits);
};

export const hashSignInCode = (code: string): string =>
  createHash("sha256").update(config.sessionSigningSecret).update(":").update(code).digest("hex");

export const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};
