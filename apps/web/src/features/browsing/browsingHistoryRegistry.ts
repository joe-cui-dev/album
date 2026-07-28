import type { PhotoCollection } from "@album/shared";
import type { BrowsingWindow } from "./browsingWindow.js";

/**
 * The Session-scoped composition root that owns Browsing Window instances (ADR-0057/0065). Keys
 * are opaque per-history-entry tokens (ADR-0053) -- the registry never derives collection from a
 * key, and it is the sole lifecycle owner: it drives every `activate`/`deactivate`/`dispose`
 * transition atomically as keys change, rather than leaving that to React mount/unmount.
 */
export interface BrowsingHistoryRegistry {
  /** Returns the (activated) window for `key`, creating it via `create` only if neither the active nor retained-inactive slot already holds it. */
  activate(key: string, collection: PhotoCollection, create: () => BrowsingWindow): BrowsingWindow;
  /**
   * Applies ADR-0067's membership rule: the mounted window whose collection the Photo just left
   * withholds it; every collection not currently mounted is invalidated (its retained-inactive
   * slot, if any, is disposed so the next activation refetches).
   */
  applyMembershipChange(change: { photoId: string; leftCollection: PhotoCollection }): void;
  /** Reverses a mounted-window withhold applied by `applyMembershipChange` (rollback on mutation failure). */
  revertMembershipChange(change: { photoId: string; leftCollection: PhotoCollection }): void;
  /**
   * New Photos from a completed Upload Batch always arrive in `active`. Per ADR-0067, a mounted
   * Timeline is deliberately left alone so it does not reflow or jump; a non-mounted Timeline slot
   * is invalidated so the next activation refetches and picks the new Photos up.
   */
  notifyPhotosArrived(): void;
  /** A Viewer Adjust/Revert moved chronology. Retained windows must refetch; a mounted one keeps its anchor and withholds its stale placement. */
  applyChronologyChange(change: { photoId: string; collection: PhotoCollection }): void;
  /** Disposes every retained window (Session loss or explicit Sign Out; ADR-0062). */
  disposeAll(): void;
}

interface Slot {
  key: string;
  collection: PhotoCollection;
  window: BrowsingWindow;
}

export const createBrowsingHistoryRegistry = (): BrowsingHistoryRegistry => {
  let active: Slot | undefined;
  let inactive: Slot | undefined;

  const withholdInMountedWindow = (photoId: string, collection: PhotoCollection, withheld: boolean): void => {
    if (active && active.collection === collection) {
      active.window.lifecycle.setWithheld(photoId, withheld);
    }
  };

  const invalidateIfNotMounted = (collection: PhotoCollection): void => {
    if (active && active.collection === collection) {
      return;
    }
    if (inactive && inactive.collection === collection) {
      inactive.window.lifecycle.dispose();
      inactive = undefined;
    }
  };

  return {
    activate: (key, collection, create) => {
      if (active?.key === key) {
        return active.window;
      }
      if (inactive?.key === key) {
        const reactivated = inactive;
        inactive = active;
        active = reactivated;
        active.window.lifecycle.activate();
        inactive?.window.lifecycle.deactivate();
        return active.window;
      }
      inactive?.window.lifecycle.dispose();
      inactive = active;
      inactive?.window.lifecycle.deactivate();
      active = { key, collection, window: create() };
      active.window.lifecycle.activate();
      return active.window;
    },
    applyMembershipChange: ({ photoId, leftCollection }) => {
      withholdInMountedWindow(photoId, leftCollection, true);
      const arrivedCollection: PhotoCollection = leftCollection === "active" ? "trashed" : "active";
      invalidateIfNotMounted(leftCollection);
      invalidateIfNotMounted(arrivedCollection);
    },
    revertMembershipChange: ({ photoId, leftCollection }) => {
      withholdInMountedWindow(photoId, leftCollection, false);
    },
    notifyPhotosArrived: () => {
      invalidateIfNotMounted("active");
    },
    applyChronologyChange: ({ photoId, collection }) => {
      // The mounted Browsing Window remains stable beneath a contextual Viewer;
      // hiding the stale descriptor avoids presenting the old chronology slot or
      // forcing a surprise live jump. Retained windows are recreated on return.
      withholdInMountedWindow(photoId, collection, true);
      invalidateIfNotMounted(collection);
    },
    disposeAll: () => {
      active?.window.lifecycle.dispose();
      inactive?.window.lifecycle.dispose();
      active = undefined;
      inactive = undefined;
    },
  };
};
