import type { PhotoCollection } from "@album/shared";
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
  /**
   * Applies ADR-0067's membership rule: the mounted window whose collection the
   * Photo just left withholds it; every collection not currently mounted is
   * invalidated (its retained-inactive slot, if any, is disposed so the next
   * activation refetches).
   */
  applyMembershipChange(change: { photoId: string; leftCollection: PhotoCollection }): void;
  /** Reverses a mounted-window withhold applied by `applyMembershipChange` (rollback on mutation failure). */
  revertMembershipChange(change: { photoId: string; leftCollection: PhotoCollection }): void;
  /**
   * New Photos from a completed Upload Batch always arrive in `active`. Per
   * ADR-0067, a mounted Timeline is deliberately left alone so it does not
   * reflow or jump; a non-mounted Timeline slot is invalidated so the next
   * activation refetches and picks the new Photos up.
   */
  notifyPhotosArrived(): void;
  /** Disposes every retained window (Session loss or explicit Sign Out; ADR-0062). */
  disposeAll(): void;
}

interface Slot {
  key: string;
  window: BrowsingWindow;
}

/** Every registry key is `${collection}:${anchor}` (see `BrowsingPage`). */
const collectionOf = (key: string): PhotoCollection => key.split(":")[0] as PhotoCollection;

export const createBrowsingHistoryRegistry = (): BrowsingHistoryRegistry => {
  let active: Slot | undefined;
  let inactive: Slot | undefined;

  const withholdInMountedWindow = (photoId: string, collection: PhotoCollection, withheld: boolean): void => {
    if (active && collectionOf(active.key) === collection) {
      active.window.intents.setWithheld(photoId, withheld);
    }
  };

  const invalidateIfNotMounted = (collection: PhotoCollection): void => {
    if (active && collectionOf(active.key) === collection) {
      return;
    }
    if (inactive && collectionOf(inactive.key) === collection) {
      inactive.window.dispose();
      inactive = undefined;
    }
  };

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
    applyMembershipChange: ({ photoId, leftCollection }) => {
      withholdInMountedWindow(photoId, leftCollection, true);
      const arrivedCollection: PhotoCollection = leftCollection === "active" ? "archived" : "active";
      invalidateIfNotMounted(leftCollection);
      invalidateIfNotMounted(arrivedCollection);
    },
    revertMembershipChange: ({ photoId, leftCollection }) => {
      withholdInMountedWindow(photoId, leftCollection, false);
    },
    notifyPhotosArrived: () => {
      invalidateIfNotMounted("active");
    },
    disposeAll: () => {
      active?.window.dispose();
      inactive?.window.dispose();
      active = undefined;
      inactive = undefined;
    },
  };
};
