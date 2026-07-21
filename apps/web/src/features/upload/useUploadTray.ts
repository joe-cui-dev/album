import { useSyncExternalStore } from "react";
import type { UploadTray, UploadTraySnapshot } from "./uploadTray.js";

/** ADR-0065: subscribe to the deep module's own snapshot with React's built-in store hook. */
export const useUploadTraySnapshot = (tray: UploadTray): UploadTraySnapshot =>
  useSyncExternalStore(tray.subscribe, tray.getSnapshot, tray.getSnapshot);
