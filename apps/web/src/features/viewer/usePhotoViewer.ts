import { useSyncExternalStore } from "react";
import type { PhotoViewer, PhotoViewerSnapshot } from "./photoViewer.js";

export const usePhotoViewerSnapshot = (viewer: PhotoViewer): PhotoViewerSnapshot =>
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot, viewer.getSnapshot);
