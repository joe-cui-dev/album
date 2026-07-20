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
  firstOpenedAt: string;
  attemptCount: number;
  lastAttemptAt: string;
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
}
