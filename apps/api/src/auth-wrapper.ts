import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { AllowedUser } from "./allowlist.js";
import { getAllowedUsers, normalizeEmail } from "./allowlist.js";
import type { AuthenticatedUser } from "./auth.js";
import { clearSessionCookie, getAuthenticatedUser } from "./auth.js";
import { config } from "./config.js";
import { guardMutationOrigin } from "./origin.js";
import { unauthorized } from "./http.js";
import type { PersonalAlbum, PersonalAlbumStore } from "./store/personal-album.js";

export interface AuthedContext {
  user: AuthenticatedUser;
  album: PersonalAlbum;
}

export const createWithAuth = ({
  store,
  resolveAllowedUsers = getAllowedUsers,
}: {
  store: PersonalAlbumStore;
  /** Injectable for tests (execution plan Slice 1.2); production reads the live USER_ALLOWLIST. */
  resolveAllowedUsers?: () => AllowedUser[];
}) =>
  (
    handle: (
      context: AuthedContext,
      event: APIGatewayProxyEventV2,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const originError = guardMutationOrigin(event, config.webOrigins);
    if (originError) return originError;

    const user = getAuthenticatedUser(event);
    if (!user) return unauthorized();

    const stillAllowed = resolveAllowedUsers().some(
      (allowedUser) => allowedUser.userId === user.userId && allowedUser.email === normalizeEmail(user.email),
    );
    if (!stillAllowed) {
      return unauthorized("Unauthorized", { cookies: [clearSessionCookie()] });
    }

    return handle({ user, album: store.personalAlbumOf(user.userId) }, event);
  };
