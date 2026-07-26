/**
 * ADR-0051: browser clock, timer, connectivity, and visibility form an internal seam. Production
 * gets a real browser adapter; tests get `testBrowsingEnvironment.ts`'s manual one. Neither
 * expands the Browsing Window's external interface -- only internals depend on this.
 */
export interface BrowsingEnvironment {
  now(): number;
  /** Schedules one callback at an absolute deadline; returns a canceller. Not a repeating interval. */
  scheduleAt(deadlineMs: number, callback: () => void): () => void;
  isOnline(): boolean;
  onOnlineChange(listener: (online: boolean) => void): () => void;
  isVisible(): boolean;
  onVisibleChange(listener: (visible: boolean) => void): () => void;
}

/** `setTimeout`'s delay is a 32-bit signed int; a lease far enough in the future must be re-armed in chunks. */
const MAX_TIMEOUT_DELAY_MS = 2_147_000_000;

export const createBrowserEnvironment = (): BrowsingEnvironment => ({
  now: () => Date.now(),
  scheduleAt: (deadlineMs, callback) => {
    let id = 0;
    const arm = (): void => {
      const remaining = deadlineMs - Date.now();
      id = remaining > MAX_TIMEOUT_DELAY_MS ? window.setTimeout(arm, MAX_TIMEOUT_DELAY_MS) : window.setTimeout(callback, Math.max(0, remaining));
    };
    arm();
    return () => window.clearTimeout(id);
  },
  isOnline: () => navigator.onLine,
  onOnlineChange: (listener) => {
    const onOnline = (): void => listener(true);
    const onOffline = (): void => listener(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  },
  isVisible: () => document.visibilityState === "visible",
  onVisibleChange: (listener) => {
    const onChange = (): void => listener(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
});
