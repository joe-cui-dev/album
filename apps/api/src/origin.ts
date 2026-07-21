import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { originRejected } from "./http.js";

const EXEMPT_METHODS = new Set(["GET", "HEAD"]);

/** The minimal event shape the guard needs, so tests don't have to fabricate a full `APIGatewayProxyEventV2`. */
export interface MutationGuardEvent {
  headers: APIGatewayProxyEventV2["headers"];
  requestContext: { http: { method: string } };
}

/**
 * Exact-Origin policy (execution plan Slice 1.1). A raw `Origin` header is allowed only if
 * it round-trips through `URL` unchanged -- this single check rejects credential-bearing
 * (`https://user:pass@host`), path-bearing (`https://host/path`), and otherwise malformed
 * candidates in one move, since `URL#origin` never reproduces those parts -- and is then an
 * exact member of the configured origin list, which also rejects suffix/substring/wildcard
 * attempts that would otherwise parse as a well-formed but different origin.
 */
export const isAllowedOrigin = (
  rawOrigin: string | undefined,
  allowedOrigins: readonly string[],
): boolean => {
  if (!rawOrigin) return false;

  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return false;
  }

  if (parsed.origin !== rawOrigin) return false;
  return allowedOrigins.includes(parsed.origin);
};

/**
 * Returns a forbidden response for any non-GET/HEAD request with a disallowed `Origin`, or
 * `undefined` to let the request proceed. Every mutation handler (directly, or via
 * `createWithAuth`) must call this before running its own logic.
 */
export const guardMutationOrigin = (
  event: MutationGuardEvent,
  allowedOrigins: readonly string[],
): APIGatewayProxyStructuredResultV2 | undefined => {
  const method = event.requestContext.http.method;
  if (EXEMPT_METHODS.has(method)) return undefined;

  const origin = event.headers.origin ?? event.headers.Origin;
  if (isAllowedOrigin(origin, allowedOrigins)) return undefined;

  return originRejected();
};
