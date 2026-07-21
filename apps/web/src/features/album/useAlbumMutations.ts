import { useSyncExternalStore } from "react";
import type { AlbumMutations, AlbumMutationsSnapshot } from "./albumMutations.js";

/** ADR-0065: subscribe to the deep module's own snapshot with React's built-in store hook. */
export const useAlbumMutationsSnapshot = (mutations: AlbumMutations): AlbumMutationsSnapshot =>
  useSyncExternalStore(mutations.subscribe, mutations.getSnapshot, mutations.getSnapshot);
