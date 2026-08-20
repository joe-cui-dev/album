import type { MembershipCollection, PhotoCollection } from "@album/shared";
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
   * slot, if any, is disposed so the next activation refetches). Also applies ADR-0067's
   * conservative propagation: the `favourite` collection is unconditionally withheld in / invalidated
   * too, without checking whether the Photo was favourited (decision 4) -- safe because a withhold on
   * an unloaded photoId is already a no-op.
   */
  applyMembershipChange(change: { photoId: string; leftCollection: MembershipCollection }): void;
  /** Reverses a mounted-window withhold applied by `applyMembershipChange` (rollback on mutation failure). */
  revertMembershipChange(change: { photoId: string; leftCollection: MembershipCollection }): void;
  /** Withholds a permanently deleted Photo without pretending it moved to another collection. */
  applyPermanentDeletion(change: { photoId: string; collection: MembershipCollection }): void;
  /** Restores the mounted view after a failed Permanent Deletion. */
  revertPermanentDeletion(change: { photoId: string; collection: MembershipCollection }): void;
  /**
   * New Photos from a completed Upload Batch always arrive in `active`. Per ADR-0067, a mounted
   * Timeline is deliberately left alone so it does not reflow or jump; a non-mounted Timeline slot
   * is invalidated so the next activation refetches and picks the new Photos up.
   */
  notifyPhotosArrived(): void;
  /**
   * A Viewer Adjust/Revert moved chronology. Retained windows must refetch; a mounted one keeps
   * its anchor and withholds its stale placement. Also applies conservative propagation to the
   * `favourite` collection (decision 4), since Adjust/Revert can move a Favourite Photo's row too.
   */
  applyChronologyChange(change: { photoId: string; collection: MembershipCollection }): void;
  /**
   * Applies favouriting/unfavouriting as its own, narrower membership change (ADR-0067): it
   * withholds in / invalidates only the `favourite` collection, since favouriting cannot affect
   * `active` or `trashed` membership.
   */
  applyFavouriteChange(change: { photoId: string; favourite: boolean }): void;
  /** Reverses a mounted-window withhold applied by `applyFavouriteChange` (rollback on mutation failure). */
  revertFavouriteChange(change: { photoId: string }): void;
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
      const arrivedCollection: MembershipCollection = leftCollection === "active" ? "trashed" : "active";
      invalidateIfNotMounted(leftCollection);
      invalidateIfNotMounted(arrivedCollection);
      withholdInMountedWindow(photoId, "favourite", true);
      invalidateIfNotMounted("favourite");
    },
    revertMembershipChange: ({ photoId, leftCollection }) => {
      withholdInMountedWindow(photoId, leftCollection, false);
      withholdInMountedWindow(photoId, "favourite", false);
    },
    applyPermanentDeletion: ({ photoId, collection }) => {
      withholdInMountedWindow(photoId, collection, true);
      invalidateIfNotMounted(collection);
    },
    revertPermanentDeletion: ({ photoId, collection }) => {
      withholdInMountedWindow(photoId, collection, false);
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
      withholdInMountedWindow(photoId, "favourite", true);
      invalidateIfNotMounted("favourite");
    },
    applyFavouriteChange: ({ photoId, favourite }) => {
      withholdInMountedWindow(photoId, "favourite", !favourite);
      invalidateIfNotMounted("favourite");
    },
    revertFavouriteChange: ({ photoId }) => {
      withholdInMountedWindow(photoId, "favourite", false);
    },
    disposeAll: () => {
      active?.window.lifecycle.dispose();
      inactive?.window.lifecycle.dispose();
      active = undefined;
      inactive = undefined;
    },
  };
};
