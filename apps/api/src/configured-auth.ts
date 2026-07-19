import { createWithAuth } from "./auth-wrapper.js";
import { personalAlbumStore } from "./store/configured-store.js";

export const withAuth = createWithAuth({ store: personalAlbumStore });
