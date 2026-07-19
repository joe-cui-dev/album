import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { AuthenticatedUser } from "./auth.js";
import { getAuthenticatedUser } from "./auth.js";
import { unauthorized } from "./http.js";
import type { PersonalAlbum, PersonalAlbumStore } from "./store/personal-album.js";

export interface AuthedContext {
  user: AuthenticatedUser;
  album: PersonalAlbum;
}

export const createWithAuth = ({ store }: { store: PersonalAlbumStore }) =>
  (
    handle: (
      context: AuthedContext,
      event: APIGatewayProxyEventV2,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const user = getAuthenticatedUser(event);
    if (!user) return unauthorized();
    return handle({ user, album: store.personalAlbumOf(user.userId) }, event);
  };
