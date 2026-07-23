import { useSyncExternalStore } from "react";
import type { CapturedAtEditor } from "./capturedAtEditor.js";

export const useCapturedAtEditorSnapshot = (editor: CapturedAtEditor) =>
  useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
