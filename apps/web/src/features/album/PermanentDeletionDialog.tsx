import { useEffect, useRef } from "react";
import { trapTab } from "../../lib/focusTrap.js";

const copyFor = (target: "photo" | "trash" | "abandon"): { title: string; description: string; confirmLabel: string } => {
  switch (target) {
    case "trash":
      return {
        title: "Empty Trash permanently?",
        description: "Every photo in Trash will be permanently deleted. This cannot be undone.",
        confirmLabel: "Empty Trash",
      };
    case "abandon":
      return {
        title: "Abandon this photo?",
        description: "This photo couldn't be processed and can't be added to your album. Abandoning it permanently deletes it. This cannot be undone.",
        confirmLabel: "Abandon photo",
      };
    case "photo":
      return {
        title: "Delete permanently?",
        description: "This photo will be permanently deleted. This cannot be undone.",
        confirmLabel: "Delete permanently",
      };
  }
};

export function PermanentDeletionDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: "photo" | "trash" | "abandon";
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { title, description, confirmLabel } = copyFor(target);

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
          {title}
        </h2>
        <p className="mt-3 text-sm text-slate-300" id="permanent-deletion-description">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded px-3 py-2" onClick={onCancel} type="button">Cancel</button>
          <button className="rounded bg-danger px-3 py-2 font-semibold text-white" onClick={onConfirm} ref={confirmRef} type="button">
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
