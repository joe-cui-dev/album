import { RETENTION_WINDOW_DAYS } from "@album/shared";
import { uiMessages } from "./uiMessages.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining in a Deleted Photo's Retention Window before the daily sweeper permanently
 * deletes it, computed client-side from `deletedAt` so a long-lived Trash page never goes stale
 * against a server-sent countdown (design decision: no `daysRemaining`/`permanentlyDeletesAt`
 * field on the wire). Can go to zero or negative on a stale page; `retentionBadgeLabel` below is
 * what keeps the displayed text from ever reading as a negative number.
 */
export const daysRemainingInTrash = (deletedAt: string, now: number = Date.now()): number =>
  Math.ceil((Date.parse(deletedAt) + RETENTION_WINDOW_DAYS * DAY_MS - now) / DAY_MS);

/** The Trash retention badge's text for a given day count. */
export const retentionBadgeLabel = (daysRemaining: number): string => {
  if (daysRemaining <= 0) {
    return uiMessages.trashRetention.deletingSoon;
  }
  if (daysRemaining <= 1) {
    return uiMessages.trashRetention.lastDay;
  }
  return uiMessages.trashRetention.daysLeft(daysRemaining);
};

/** True once the badge should switch to its warning colour. */
export const isRetentionUrgent = (daysRemaining: number): boolean => daysRemaining <= 3;
