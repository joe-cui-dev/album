/**
 * Keeps Tab/Shift+Tab cycling within `container` for a true modal dialog. Call from a
 * `keydown` listener on `"Tab"`. Shared by every modal surface (Viewer, chronology editor,
 * mobile date sheet) so the cycling rule stays in one place.
 */
export const trapTab = (event: KeyboardEvent, container: HTMLElement | null): void => {
  if (!container) {
    return;
  }
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
