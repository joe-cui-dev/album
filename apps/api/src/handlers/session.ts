import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { GetSessionResponse } from "@album/shared";
import { getAllowedUsers, normalizeEmail } from "../allowlist.js";
import { clearSessionCookie, getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { json, ok } from "../http.js";
import { guardMutationOrigin } from "../origin.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const originError = guardMutationOrigin(event, config.webOrigins);
  if (originError) return originError;

  if (event.routeKey === "GET /session") {
    const user = getAuthenticatedUser(event);
    if (!user) return ok({ signedIn: false } satisfies GetSessionResponse);

    const stillAllowed = getAllowedUsers().some(
      (allowedUser) => allowedUser.userId === user.userId && allowedUser.email === normalizeEmail(user.email),
    );
    if (!stillAllowed) {
      return ok({ signedIn: false } satisfies GetSessionResponse, { cookies: [clearSessionCookie()] });
    }

    return ok({ signedIn: true, user } satisfies GetSessionResponse);
  }
  if (event.routeKey === "DELETE /session") {
    return ok({ signedIn: false } satisfies GetSessionResponse, { cookies: [clearSessionCookie()] });
  }
  return json(404, { message: "Not found" });
};
