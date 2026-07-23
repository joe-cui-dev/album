/** Conservative fallback TTL used only when a response has no presigned source to derive one from. */
export const DEFAULT_ACCESS_TTL_SECONDS = 300;

/** ISO expiry for the shortest-lived presigned source in a batch, so the client never over-trusts access. */
export const conservativeExpiresAt = (
  expiresInSecondsValues: number[],
  now: () => number = Date.now,
): string => {
  const ttlSeconds = expiresInSecondsValues.length
    ? Math.min(...expiresInSecondsValues)
    : DEFAULT_ACCESS_TTL_SECONDS;
  return new Date(now() + ttlSeconds * 1000).toISOString();
};
