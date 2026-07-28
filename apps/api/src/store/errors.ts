/** The caller's expected chronology revision no longer matches the Photo's active revision. */
export class StaleChronologyRevisionError extends Error {
  constructor(readonly photoId: string) {
    super(`Stale chronology revision for Photo ${photoId}`);
    this.name = "StaleChronologyRevisionError";
  }
}

/** Another live processing attempt already owns this Photo. */
export class ProcessingAttemptConflictError extends Error {
  constructor(readonly photoId: string) {
    super(`Processing attempt conflict for Photo ${photoId}`);
    this.name = "ProcessingAttemptConflictError";
  }
}

/**
 * The Photo's trash membership or chronology revision changed between
 * this operation's read and its transactional write (e.g. a concurrent
 * Trash/Restore racing an Adjust/Revert on the same Photo). The caller
 * should re-read the Photo and retry.
 */
export class ConcurrentPhotoModificationError extends Error {
  constructor(readonly photoId: string) {
    super(`Photo ${photoId} changed concurrently; retry`);
    this.name = "ConcurrentPhotoModificationError";
  }
}
