import type {
  CapturedAt,
  CapturedAtSource,
  Dimensions,
  OriginalCapturedAtSource,
  Photo,
  PhotoFormat,
  PhotoMetadata,
  ProcessingState,
  TimelineThumbnails,
  UploadBatch,
} from "@album/shared";

export type PhotoCollection = "active" | "archived";

export type ProcessingIssueStatus = "failed" | "retrying";

export interface ProcessingIssueRecord {
  photoId: string;
  fileName: string;
  reasonCode: string;
  status: ProcessingIssueStatus;
  addedAt: string;
  firstOpenedAt: string;
  attemptCount: number;
  lastAttemptAt: string;
  /** Internal id of the retry message currently in flight, if any. */
  retryAttemptId?: string;
  retryReservationExpiresAt?: string;
}

export interface TimelineProjection {
  photoId: string;
  collection: PhotoCollection;
  capturedAt: CapturedAt;
  addedAt: string;
  fileName: string;
  displayDimensions: Dimensions;
  timelineThumbnails: TimelineThumbnails;
}

export interface DateIndexPeriodCounts {
  /** Keyed by "01"-"12" or "unknown"; zero counters may be omitted. */
  [period: string]: number;
}

export interface PersonalAlbumStore {
  personalAlbumOf(userId: string): PersonalAlbum;
}

export interface PersonalAlbum {
  getPhoto(photoId: string): Promise<Photo | undefined>;
  getUploadBatch(uploadBatchId: string): Promise<UploadBatch | undefined>;
  listTimelinePhotos(input: {
    fromCapturedAt?: string;
    toCapturedAt?: string;
    processingState?: ProcessingState;
    archived?: boolean;
  }): Promise<Photo[]>;
  findReadyPhotoBySha256(input: {
    sha256: string;
    excludePhotoId: string;
  }): Promise<{ photoId: string } | undefined>;
  createPhoto(input: {
    photoId: string;
    uploadBatchId: string;
    originalObjectKey: string;
    fileName: string;
    format: PhotoFormat;
    contentType: string;
    fileSizeBytes: number;
    clientSha256?: string;
    uploadRequestedAt: string;
    fileModifiedAt?: string;
    /** Upload-context-local calendar values, derived once at upload time so reads never reinterpret them. */
    fileModifiedLocalDateTime?: string;
    uploadLocalDateTime?: string;
    uploadContextTimeZone?: string;
  }): Promise<void>;
  createUploadBatch(input: {
    uploadBatchId: string;
    createdAt: string;
    photoIds: string[];
  }): Promise<void>;
  markProcessingStarted(photoId: string): Promise<void>;
  markProcessingFailed(input: {
    photoId: string;
    failureCode: string;
    failureMessage: string;
  }): Promise<void>;
  markExactDuplicate(input: {
    photoId: string;
    sha256: string;
    duplicateOfPhotoId: string;
  }): Promise<void>;
  markReady(input: {
    photoId: string;
    sha256: string;
    fileName: string;
    displayObjectKey: string;
    displayDimensions: { width: number; height: number };
    timelineThumbnailObjectKey: string;
    timelineThumbnailDimensions: { width: number; height: number };
    capturedAt: string;
    capturedAtSource: CapturedAtSource;
    metadata: PhotoMetadata;
  }): Promise<void>;
  archivePhoto(photoId: string): Promise<void>;

  // --- v2 store transaction model (Phase 2 WP2) ---

  /**
   * Atomically publishes a Ready Photo: sets original/active chronology at
   * revision 0, writes its Active-collection Timeline projection (using the
   * Photo's uploadRequestedAt as Added At), updates the Active Date Index,
   * and resolves any open Processing Issue.
   */
  publishReadyPhotoV2(input: {
    photoId: string;
    fileName: string;
    sha256: string;
    displayObjectKey: string;
    displayDimensions: Dimensions;
    timelineThumbnails: TimelineThumbnails;
    metadata: PhotoMetadata;
    originalCapturedAt: CapturedAt;
    originalCapturedAtSource: OriginalCapturedAtSource;
    /** The attemptId that must currently own this Photo, if this publish completes a claimed attempt. */
    attemptId?: string;
    /** True when a Processing Issue is currently open for this Photo (a retry succeeding). */
    hadOpenProcessingIssue: boolean;
  }): Promise<void>;

  /** Atomically publishes an Exact Duplicate: no projection is created. */
  publishExactDuplicateV2(input: {
    photoId: string;
    sha256: string;
    duplicateOfPhotoId: string;
    attemptId?: string;
    hadOpenProcessingIssue: boolean;
  }): Promise<void>;

  /**
   * Atomically moves a Ready Photo between the Active and Archived
   * collections, transferring its Date Index count. A Photo already in the
   * target collection is left unchanged (idempotent membership).
   */
  setArchiveMembershipV2(input: { photoId: string; archived: boolean }): Promise<void>;

  /**
   * Replaces the complete active chronology (Adjust Captured At), moving the
   * Timeline/Archive projection and transferring Date Index period counts.
   * An identical replacement of the current active value is a no-op that
   * does not advance the revision. Throws StaleChronologyRevisionError when
   * expectedRevision does not match the Photo's current active revision.
   */
  replaceActiveChronologyV2(input: {
    photoId: string;
    capturedAt: CapturedAt;
    expectedRevision: number;
  }): Promise<{ revision: number }>;

  /**
   * Restores the active chronology to the Photo's immutable original value
   * and source (Revert Captured At). Already-reverted is a no-op that does
   * not advance the revision. Throws StaleChronologyRevisionError when
   * expectedRevision does not match the Photo's current active revision.
   */
  revertActiveChronologyV2(input: {
    photoId: string;
    expectedRevision: number;
  }): Promise<{ revision: number }>;

  /**
   * Creates or updates the durable Processing Issue for a failed Photo and
   * maintains the exact open count, clearing any owning processing attempt.
   */
  recordProcessingIssueV2(input: {
    photoId: string;
    fileName: string;
    reasonCode: string;
    attemptedAt: string;
    attemptId?: string;
  }): Promise<void>;

  getProcessingIssue(photoId: string): Promise<ProcessingIssueRecord | undefined>;

  /** Marks an open Issue retrying after its message has been accepted by SQS. */
  beginProcessingIssueRetryV2(input: {
    photoId: string;
    retryAttemptId: string;
    attemptedAt: string;
  }): Promise<{ retryAttemptId: string }>;

  /** Reserves the sole retry attempt before its message is sent to SQS. */
  reserveProcessingIssueRetryV2(input: {
    photoId: string;
    retryAttemptId: string;
    reservedAt: string;
    reservationExpiresAt: string;
  }): Promise<{ retryAttemptId: string }>;

  /** Releases an unsent retry reservation after an SQS send failure. */
  releaseProcessingIssueRetryV2(input: {
    photoId: string;
    retryAttemptId: string;
  }): Promise<void>;

  /** One newest-first page of durable Processing Issues. */
  queryProcessingIssuesV2(input: {
    limit: number;
    after?: { sortKey: string };
  }): Promise<{ issues: ProcessingIssueRecord[]; lastSortKey?: string }>;

  /**
   * Claims a processing attempt for a Photo. Returns "claimed" for a fresh
   * claim, "resumed" when the same attemptId is redelivered. Throws
   * ProcessingAttemptConflictError when a different attempt already owns
   * this Photo.
   */
  claimProcessingAttempt(input: {
    photoId: string;
    attemptId: string;
    startedAt: string;
  }): Promise<"claimed" | "resumed">;

  /**
   * Applies (or idempotently repairs) v2 migration state for one legacy
   * Ready Photo during backfill: initializes original/active chronology at
   * revision 0 when absent, ensures both Timeline Thumbnail variants,
   * writes the correct collection projection and Date Index contribution,
   * and records migrationVersion. A Photo already at or above
   * migrationVersion is left unchanged.
   */
  applyMigrationVersionV2(input: {
    photoId: string;
    migrationVersion: number;
    originalCapturedAt: CapturedAt;
    originalCapturedAtSource: OriginalCapturedAtSource;
    timelineThumbnails: TimelineThumbnails;
  }): Promise<void>;

  getTimelineProjectionsV2(collection: PhotoCollection): Promise<TimelineProjection[]>;
  getDateIndexV2(
    collection: PhotoCollection,
    year: number,
  ): Promise<DateIndexPeriodCounts>;

  /**
   * One strongly consistent, newest-first page of a collection's Timeline
   * projections. `after` resumes strictly after a prior page's last sort
   * key (cursor continuation); `atOrBefore` anchors the page at or below a
   * `startAt` navigation period, mutually exclusive with `after`. Returns
   * `lastSortKey` (for building the next cursor) only when the page was
   * full, since fewer than `limit` results means there is nothing older.
   */
  queryTimelinePageV2(input: {
    collection: PhotoCollection;
    limit: number;
    after?: { sortKey: string };
    atOrBefore?: { sortKey: string };
  }): Promise<{ projections: TimelineProjection[]; lastSortKey?: string }>;

  /** Every year with a non-empty Date Index item in one collection. */
  listDateIndexYearsV2(
    collection: PhotoCollection,
  ): Promise<Array<{ year: number; counts: DateIndexPeriodCounts }>>;

  /**
   * The nearest live projection strictly newer ("newer") or older ("older")
   * than the given projection's exact position, within the same collection.
   * Used to derive Photo Viewer neighbours from existing v2 projection sort
   * order without persisting any previous/next link.
   */
  queryAdjacentProjectionV2(input: {
    collection: PhotoCollection;
    capturedAt: CapturedAt;
    addedAt: string;
    photoId: string;
    direction: "newer" | "older";
  }): Promise<TimelineProjection | undefined>;

  /** The exact count of currently open Processing Issues. */
  getProcessingIssuesSummary(): Promise<number>;

  /** Up to 100 Photos by id; missing ids are silently omitted. */
  getPhotosByIds(photoIds: string[]): Promise<Photo[]>;
}
