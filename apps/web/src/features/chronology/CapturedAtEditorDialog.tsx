import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PhotoChronology } from "@album/shared";
import { capturedAtSourceLabel } from "../../lib/capturedAtSource.js";
import { formatCapturedAt } from "../../lib/capturedAtFormat.js";
import { trapTab } from "../../lib/focusTrap.js";
import { createCapturedAtEditor, type CapturedAtEditor } from "./capturedAtEditor.js";
import type { CapturedAtEditorPort } from "./capturedAtEditorPort.js";
import { useCapturedAtEditorSnapshot } from "./useCapturedAtEditor.js";

interface Props {
  photoId: string;
  collection: "active" | "archived";
  chronology: PhotoChronology;
  port: CapturedAtEditorPort;
  onSuccess(result: { kind: "adjust" | "revert"; capturedAt: import("@album/shared").CapturedAt; source: PhotoChronology["active"]["source"] }): void;
  /** `true` means browser Back already consumed the temporary editor entry. */
  onDismiss(fromHistory?: boolean): void;
  /** Incremented by the owning Viewer after its router observes a temporary-entry Back. */
  historyBackSignal: number;
  restoreHistoryEntry(): void;
}

/** Accessible form shell only; draft, request and conflict rules stay in capturedAtEditor. */
export function CapturedAtEditorDialog(props: Props) {
  const editorRef = useRef<CapturedAtEditor | undefined>(undefined);
  if (!editorRef.current) {
    editorRef.current = createCapturedAtEditor({ ...props, onDismiss: () => props.onDismiss(false) });
  }
  const editor = editorRef.current;
  const snapshot = useCapturedAtEditorSnapshot(editor);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const offsetRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const handledHistoryBackSignalRef = useRef(0);

  useEffect(() => {
    dateRef.current?.focus();
    return () => editor.dispose();
  }, [editor]);

  useEffect(() => {
    if (snapshot.errors.date) dateRef.current?.focus();
    else if (snapshot.errors.time || snapshot.errors.timeIncludes) timeRef.current?.focus();
    else if (snapshot.errors.offset) offsetRef.current?.focus();
  }, [snapshot.errors]);

  useEffect(() => {
    if (props.historyBackSignal === 0 || props.historyBackSignal === handledHistoryBackSignalRef.current) return;
    handledHistoryBackSignalRef.current = props.historyBackSignal;
    if (editor.getSnapshot().dirty) {
      props.restoreHistoryEntry();
      editor.intents.requestClose();
    } else {
      props.onDismiss(true);
    }
  }, [editor, props, props.historyBackSignal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        editor.intents.requestClose();
      } else if (event.key === "Tab") {
        trapTab(event, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  const body = (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 sm:items-center" role="presentation">
      <section aria-describedby="captured-at-editor-help" aria-labelledby="captured-at-editor-title" aria-modal="true" className="w-full max-w-lg rounded-lg bg-white p-5 text-stone-950 shadow-xl" ref={dialogRef} role="dialog">
        {snapshot.mode === "discard" ? (
          <DiscardState editor={editor} />
        ) : snapshot.mode === "conflict" ? (
          <ConflictState editor={editor} {...(snapshot.latest ? { latest: snapshot.latest } : {})} />
        ) : snapshot.mode === "revert" ? (
          <RevertState chronology={snapshot.chronology} editor={editor} saving={snapshot.saving} />
        ) : (
          <EditState dateRef={dateRef} editor={editor} offsetRef={offsetRef} snapshot={snapshot} timeRef={timeRef} />
        )}
      </section>
    </div>
  );
  return createPortal(body, document.body);
}

function EditState({ editor, snapshot, dateRef, timeRef, offsetRef }: { editor: CapturedAtEditor; snapshot: ReturnType<CapturedAtEditor["getSnapshot"]>; dateRef: RefObject<HTMLInputElement | null>; timeRef: RefObject<HTMLInputElement | null>; offsetRef: RefObject<HTMLInputElement | null> }) {
  const { draft, errors } = snapshot;
  return (
    <>
      <h2 className="text-xl font-bold" id="captured-at-editor-title">Adjust date and time</h2>
      <p className="mt-1 text-sm text-stone-600" id="captured-at-editor-help">Enter the date and local time shown by the Photo. Leave UTC offset blank when it is unknown.</p>
      <div aria-live="assertive" className="mt-3 text-sm text-red-700" role="alert">{snapshot.networkError}</div>
      <div className="mt-4 grid gap-4">
        <FieldError {...(errors.date ? { error: errors.date } : {})} id="captured-at-date-error" />
        <label className="grid gap-1" htmlFor="captured-at-date">Date <input aria-describedby={errors.date ? "captured-at-date-error" : undefined} aria-invalid={Boolean(errors.date)} className="rounded border border-stone-400 px-3 py-2" id="captured-at-date" onChange={(event) => editor.intents.change("date", event.target.value)} ref={dateRef} required type="date" value={draft.date} /></label>
        <FieldError {...(errors.time ? { error: errors.time } : {})} id="captured-at-time-error" />
        <label className="grid gap-1" htmlFor="captured-at-time">Time <input aria-describedby={errors.time ? "captured-at-time-error" : undefined} aria-invalid={Boolean(errors.time)} className="rounded border border-stone-400 px-3 py-2" id="captured-at-time" onChange={(event) => editor.intents.change("time", event.target.value)} ref={timeRef} required type="text" value={draft.time} /></label>
        <label className="grid gap-1" htmlFor="captured-at-resolution">Time includes
          <select className="rounded border border-stone-400 px-3 py-2" id="captured-at-resolution" onChange={(event) => editor.intents.change("timeIncludes", event.target.value)} value={draft.timeIncludes}>
            <option value="minute">Minutes</option><option value="second">Seconds</option><option value="subsecond">Fractions of a second</option>
          </select>
        </label>
        <FieldError {...(errors.offset ? { error: errors.offset } : {})} id="captured-at-offset-error" />
        <label className="grid gap-1" htmlFor="captured-at-offset">UTC offset (optional)<input aria-describedby={errors.offset ? "captured-at-offset-error" : undefined} aria-invalid={Boolean(errors.offset)} className="rounded border border-stone-400 px-3 py-2" id="captured-at-offset" onChange={(event) => editor.intents.change("offset", event.target.value)} placeholder="+10:00" ref={offsetRef} type="text" value={draft.offset} /></label>
      </div>
      <div className="mt-6 flex justify-between gap-3"><button className="rounded px-3 py-2" disabled={snapshot.saving} onClick={editor.intents.requestClose} type="button">Cancel</button><div className="flex gap-2">{canRevert(snapshot.chronology) ? <button className="rounded px-3 py-2 text-red-700" disabled={snapshot.saving} onClick={editor.intents.beginRevert} type="button">Revert to original date and time</button> : null}<button className="rounded bg-emerald-800 px-3 py-2 font-semibold text-white disabled:opacity-50" disabled={snapshot.saving} onClick={snapshot.networkError ? editor.intents.retry : editor.intents.save} type="button">{snapshot.saving ? "Saving…" : snapshot.networkError ? "Retry" : "Save"}</button></div></div>
    </>
  );
}

function DiscardState({ editor }: { editor: CapturedAtEditor }) {
  return <><h2 className="text-xl font-bold" id="captured-at-editor-title">Discard changes?</h2><p className="mt-2" id="captured-at-editor-help">Your unsaved date and time changes will be lost.</p><div className="mt-6 flex justify-end gap-2"><button className="rounded px-3 py-2" onClick={editor.intents.keepEditing} type="button">Keep editing</button><button className="rounded bg-red-700 px-3 py-2 font-semibold text-white" onClick={editor.intents.discard} type="button">Discard</button></div></>;
}

function ConflictState({ editor, latest }: { editor: CapturedAtEditor; latest?: PhotoChronology }) {
  return <><h2 className="text-xl font-bold" id="captured-at-editor-title">Date and time changed</h2><p className="mt-2" id="captured-at-editor-help">Someone changed this Photo’s date and time while you were editing.</p>{latest ? <p className="mt-3 rounded bg-stone-100 p-3">Latest: {formatCapturedAt(latest.active.capturedAt, "detail")} · {capturedAtSourceLabel(latest.active.source)}</p> : null}<div className="mt-6 flex justify-end gap-2"><button className="rounded px-3 py-2" onClick={editor.intents.useLatest} type="button">Use latest</button><button className="rounded bg-emerald-800 px-3 py-2 font-semibold text-white" onClick={editor.intents.keepMyChanges} type="button">Keep my changes</button></div></>;
}

function RevertState({ chronology, editor, saving }: { chronology: PhotoChronology; editor: CapturedAtEditor; saving: boolean }) {
  return <><h2 className="text-xl font-bold" id="captured-at-editor-title">Revert to original date and time?</h2><dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm" id="captured-at-editor-help"><dt>Current</dt><dd>{formatCapturedAt(chronology.active.capturedAt, "detail")}</dd><dt>Original</dt><dd>{formatCapturedAt(chronology.original.capturedAt, "detail")}</dd><dt>Original source</dt><dd>{capturedAtSourceLabel(chronology.original.source)}</dd></dl><div className="mt-6 flex justify-end gap-2"><button className="rounded px-3 py-2" disabled={saving} onClick={editor.intents.cancelRevert} type="button">Cancel</button><button className="rounded bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50" disabled={saving} onClick={editor.intents.confirmRevert} type="button">{saving ? "Reverting…" : "Revert"}</button></div></>;
}

function FieldError({ id, error }: { id: string; error?: string }) { return error ? <p className="text-sm text-red-700" id={id}>{error}</p> : null; }
const canRevert = (chronology: PhotoChronology) => chronology.active.source === "userAdjusted" && JSON.stringify(chronology.active.capturedAt) !== JSON.stringify(chronology.original.capturedAt);

