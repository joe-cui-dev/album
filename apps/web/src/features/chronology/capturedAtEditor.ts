import { validateCapturedAt, type CapturedAt, type PhotoChronology } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import type { CapturedAtEditorPort } from "./capturedAtEditorPort.js";

export type CapturedAtEditorMode = "edit" | "discard" | "conflict" | "revert";
export type TimeIncludes = "minute" | "second" | "subsecond";

export interface CapturedAtDraft {
  date: string;
  time: string;
  timeIncludes: TimeIncludes;
  offset: string;
}

export interface CapturedAtEditorSnapshot {
  mode: CapturedAtEditorMode;
  draft: CapturedAtDraft;
  dirty: boolean;
  saving: boolean;
  errors: Partial<Record<keyof CapturedAtDraft, string>>;
  networkError?: string;
  latest?: PhotoChronology;
  chronology: PhotoChronology;
}

export interface CapturedAtEditor {
  getSnapshot(): CapturedAtEditorSnapshot;
  subscribe(listener: () => void): () => void;
  intents: {
    change(field: keyof CapturedAtDraft, value: string): void;
    save(): void;
    requestClose(): void;
    keepEditing(): void;
    discard(): void;
    beginRevert(): void;
    cancelRevert(): void;
    confirmRevert(): void;
    useLatest(): void;
    keepMyChanges(): void;
    retry(): void;
  };
  dispose(): void;
}

export const draftFromCapturedAt = (capturedAt: CapturedAt): CapturedAtDraft =>
  capturedAt.precision === "dateTime"
    ? {
        date: capturedAt.localDate,
        time: capturedAt.localTime,
        timeIncludes: capturedAt.timeResolution,
        offset: capturedAt.offset ?? "",
      }
    : { date: "", time: "", timeIncludes: "minute", offset: "" };

const canonicalCapturedAt = (draft: CapturedAtDraft): CapturedAt => {
  const localTime =
    draft.timeIncludes === "subsecond" && draft.time.includes(".")
      ? `${draft.time.slice(0, draft.time.indexOf(".") + 1)}${draft.time.slice(draft.time.indexOf(".") + 1).replace(/0+$/, "") || "0"}`
      : draft.time;
  return {
    precision: "dateTime",
    localDate: draft.date,
    localTime,
    timeResolution: draft.timeIncludes,
    ...(draft.offset.trim() ? { offset: draft.offset.trim() } : {}),
  } as CapturedAt;
};

const draftKey = (draft: CapturedAtDraft): string => JSON.stringify(draft);

/** Deep state machine for complete date-and-time replacement and revert. */
export const createCapturedAtEditor = (options: {
  photoId: string;
  collection: "active" | "trashed";
  chronology: PhotoChronology;
  port: CapturedAtEditorPort;
  onSuccess(result: { kind: "adjust" | "revert"; capturedAt: CapturedAt; source: PhotoChronology["active"]["source"] }): void;
  onDismiss(): void;
}): CapturedAtEditor => {
  let disposed = false;
  const listeners = new Set<() => void>();
  let chronology = options.chronology;
  let draft = draftFromCapturedAt(chronology.active.capturedAt);
  let pristineKey = draftKey(draft);
  let mode: CapturedAtEditorMode = "edit";
  let saving = false;
  let errors: CapturedAtEditorSnapshot["errors"] = {};
  let networkError: string | undefined;
  let latest: PhotoChronology | undefined;
  let controller: AbortController | undefined;
  let retry: (() => void) | undefined;
  let cached: CapturedAtEditorSnapshot | undefined;

  const notify = () => {
    cached = undefined;
    listeners.forEach((listener) => listener());
  };
  const dirty = () => draftKey(draft) !== pristineKey;
  const snapshot = (): CapturedAtEditorSnapshot => {
    if (!cached) {
      cached = { mode, draft, dirty: dirty(), saving, errors, ...(networkError ? { networkError } : {}), ...(latest ? { latest } : {}), chronology };
    }
    return cached;
  };

  const showConflict = async () => {
    const conflictController = new AbortController();
    controller = conflictController;
    saving = true;
    networkError = undefined;
    notify();
    try {
      const current = await options.port.loadLatest({ photoId: options.photoId, collection: options.collection, signal: conflictController.signal });
      if (disposed || conflictController.signal.aborted) return;
      latest = current.chronology;
      mode = "conflict";
    } catch {
      if (disposed || conflictController.signal.aborted) return;
      networkError = "Couldn’t refresh the latest date and time. Try again.";
      retry = () => void showConflict();
    } finally {
      if (!disposed && controller === conflictController) {
        controller = undefined;
        saving = false;
        notify();
      }
    }
  };

  const submit = async (kind: "adjust" | "revert") => {
    if (saving || disposed) return;
    if (kind === "adjust") {
      const validation = validateCapturedAt(canonicalCapturedAt(draft));
      if (validation.length) {
        errors = {};
        for (const issue of validation) {
          const field = issue.path === "localDate" ? "date" : issue.path === "localTime" ? "time" : issue.path === "timeResolution" ? "timeIncludes" : "offset";
          errors[field] ??= issue.message;
        }
        notify();
        return;
      }
    }
    const requestController = new AbortController();
    controller = requestController;
    saving = true;
    networkError = undefined;
    errors = {};
    notify();
    try {
      if (kind === "adjust") {
        await options.port.adjust({ photoId: options.photoId, capturedAt: canonicalCapturedAt(draft), revision: chronology.active.revision, signal: requestController.signal });
      } else {
        await options.port.revert({ photoId: options.photoId, revision: chronology.active.revision, signal: requestController.signal });
      }
      if (disposed || requestController.signal.aborted) return;
      options.onSuccess(
        kind === "adjust"
          ? { kind, capturedAt: canonicalCapturedAt(draft), source: "userAdjusted" }
          : { kind, capturedAt: chronology.original.capturedAt, source: chronology.original.source },
      );
      options.onDismiss();
    } catch (error) {
      if (disposed || requestController.signal.aborted) return;
      if (error instanceof AlbumTransportError && error.code === "chronology_changed") {
        void showConflict();
        return;
      }
      networkError = kind === "adjust" ? "Couldn’t save the date and time. Try again." : "Couldn’t revert the date and time. Try again.";
      retry = () => void submit(kind);
    } finally {
      if (!disposed && controller === requestController) {
        controller = undefined;
        saving = false;
        notify();
      }
    }
  };

  return {
    getSnapshot: snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    intents: {
      change: (field, value) => { if (!saving) { draft = { ...draft, [field]: value }; errors = {}; networkError = undefined; notify(); } },
      save: () => void submit("adjust"),
      requestClose: () => { if (saving) return; if (dirty()) { mode = "discard"; notify(); } else options.onDismiss(); },
      keepEditing: () => { mode = "edit"; notify(); },
      discard: () => options.onDismiss(),
      beginRevert: () => { if (!saving) { mode = "revert"; notify(); } },
      cancelRevert: () => { mode = "edit"; notify(); },
      confirmRevert: () => void submit("revert"),
      useLatest: () => { if (latest) { chronology = latest; draft = draftFromCapturedAt(latest.active.capturedAt); pristineKey = draftKey(draft); latest = undefined; mode = "edit"; notify(); } },
      keepMyChanges: () => { if (latest) { chronology = { ...chronology, active: { ...chronology.active, revision: latest.active.revision } }; latest = undefined; mode = "edit"; notify(); } },
      retry: () => retry?.(),
    },
    dispose: () => { disposed = true; controller?.abort(); controller = undefined; listeners.clear(); },
  };
};
