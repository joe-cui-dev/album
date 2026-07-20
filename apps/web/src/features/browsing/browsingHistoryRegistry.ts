import type { BrowsingWindow } from "./browsingWindow.js";

/**
 * The Session-scoped composition root that owns Browsing Window instances
 * (ADR-0065). Retains the active window plus only the most recently inactive
 * one; any other key recreates from its URL anchor rather than promising an
 * evicted deep scroll position (ADR-0057).
 */
export interface BrowsingHistoryRegistry {
  /** Returns the window for `key`, creating it via `create` only if neither the active nor retained-inactive slot already holds it. */
  activate(key: string, create: () => BrowsingWindow): BrowsingWindow;
  /** Disposes every retained window (Session loss or explicit Sign Out; ADR-0062). */
  disposeAll(): void;
}

interface Slot {
  key: string;
  window: BrowsingWindow;
}

export const createBrowsingHistoryRegistry = (): BrowsingHistoryRegistry => {
  let active: Slot | undefined;
  let inactive: Slot | undefined;

  return {
    activate: (key, create) => {
      if (active?.key === key) {
        return active.window;
      }
      if (inactive?.key === key) {
        const reactivated = inactive;
        inactive = active;
        active = reactivated;
        return reactivated.window;
      }
      inactive?.window.dispose();
      inactive = active;
      active = { key, window: create() };
      return active.window;
    },
    disposeAll: () => {
      active?.window.dispose();
      inactive?.window.dispose();
      active = undefined;
      inactive = undefined;
    },
  };
};
