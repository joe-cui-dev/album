import { useSyncExternalStore } from "react";
import type { BrowsingWindow, BrowsingWindowSnapshot } from "./browsingWindow.js";

/** ADR-0065: subscribe to the deep module's own snapshot with React's built-in store hook. */
export const useBrowsingWindowSnapshot = (browsingWindow: BrowsingWindow): BrowsingWindowSnapshot =>
  useSyncExternalStore(browsingWindow.subscribe, browsingWindow.getSnapshot, browsingWindow.getSnapshot);
