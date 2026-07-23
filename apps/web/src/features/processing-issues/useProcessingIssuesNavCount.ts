import { useSyncExternalStore } from "react";
import type { ProcessingIssuesNavCount, ProcessingIssuesNavCountSnapshot } from "./processingIssuesNavCount.js";

/** ADR-0065: subscribe to the deep module's own snapshot with React's built-in store hook. */
export const useProcessingIssuesNavCountSnapshot = (
  navCount: ProcessingIssuesNavCount,
): ProcessingIssuesNavCountSnapshot =>
  useSyncExternalStore(navCount.subscribe, navCount.getSnapshot, navCount.getSnapshot);
