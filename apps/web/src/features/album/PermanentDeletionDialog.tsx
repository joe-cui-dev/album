import { useEffect, useRef } from "react";
import { trapTab } from "../../lib/focusTrap.js";

export function PermanentDeletionDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: "photo" | "trash";
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const isTrash = target === "trash";

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <section
        aria-describedby="permanent-deletion-description"
        aria-labelledby="permanent-deletion-title"
        aria-modal="true"
        className="prismatic-dialog max-w-md"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
          if (event.key === "Tab") trapTab(event.nativeEvent, dialogRef.current);
        }}
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="text-xl font-bold" id="permanent-deletion-title">
          {isTrash ? "Empty Trash permanently?" : "Delete permanently?"}
        </h2>
        <p className="mt-3 text-sm text-slate-300" id="permanent-deletion-description">
          {isTrash ? "Every photo in Trash will be permanently deleted. This cannot be undone." : "This photo will be permanently deleted. This cannot be undone."}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded px-3 py-2" onClick={onCancel} type="button">Cancel</button>
          <button className="rounded bg-danger px-3 py-2 font-semibold text-white" onClick={onConfirm} ref={confirmRef} type="button">
            {isTrash ? "Empty Trash" : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}
