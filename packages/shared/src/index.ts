import type { CapturedAt, CapturedAtSource, OriginalCapturedAtSource } from "./chronology.js";
import type { Dimensions, TimelineThumbnails } from "./thumbnails.js";

export type PhotoFormat = "jpeg" | "png" | "heic";

export const maxFilesPerUploadBatch = 100;
export const maxOriginalPhotoBytes = 50 * 1024 * 1024;
export const displayPhotoLongestEdgePixels = 2048;
export const timelineThumbnailLongestEdgePixels = 320;
export const timelineThumbnailLargeLongestEdgePixels = 640;

export const supportedPhotoFormats = ["jpeg", "png", "heic"] as const;

export {
  DISPLAY_KEY_PREFIX,
  ORIGINALS_KEY_PREFIX,
  TIMELINE_THUMBNAILS_KEY_PREFIX,
  buildDisplayObjectKey,
  buildOriginalObjectKey,
  buildTimelineThumbnailLargeObjectKey,
  buildTimelineThumbnailObjectKey,
  matchesOriginalObjectMetadata,
  originalUploadMetadata,
  parseOriginalObjectKey,
} from "./photo-keys.js";
export type { OriginalObjectKeyParts } from "./photo-keys.js";

export {
  buildChronologyKey,
  getCapturedAtComponents,
  isCapturedAt,
  isSameCapturedAt,
  timelineAnchorOf,
  validateCapturedAt,
} from "./chronology.js";
export type {
  CapturedAt,
  CapturedAtComponents,
  CapturedAtPrecision,
  CapturedAtSource,
  CapturedAtTimeResolution,
  CapturedAtValidationError,
  DateTimeCapturedAt,
  DayCapturedAt,
  MonthCapturedAt,
  OriginalCapturedAtSource,
  YearCapturedAt,
} from "./chronology.js";

export type { Dimensions, TimelineThumbnailVariant, TimelineThumbnails } from "./thumbnails.js";

export const photoFormatForFile = (input: {
  fileName: string;
  contentType: string;
}): PhotoFormat | undefined => {
  const extension = input.fileName.split(".").pop()?.toLowerCase();
  if (
    input.contentType === "image/jpeg" &&
    (extension === "jpg" || extension === "jpeg")
  ) {
    return "jpeg";
  }
  if (input.contentType === "image/png" && extension === "png") {
    return "png";
  }
  if (
    (input.contentType === "image/heic" ||
      input.contentType === "image/heif") &&
    (extension === "heic" || extension === "heif")
  ) {
    return "heic";
  }
  return undefined;
};

export type ProcessingState =
  | "uploadRequested"
  | "processing"
  | "ready"
  | "processingFailed"
  | "exactDuplicate";

export interface PhotoMetadata {
  width?: number;
  height?: number;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface Photo {
  photoId: string;
  userId: string;
  uploadBatchId: string;
  originalObjectKey: string;
  displayObjectKey?: string;
  fileName: string;
  format: PhotoFormat;
  contentType?: string;
  fileSizeBytes: number;
  sha256?: string;
  clientSha256?: string;
  uploadRequestedAt?: string;
  fileModifiedAt?: string;
  processingState: ProcessingState;
  failureCode?: string;
  /** Set when this Photo was identified as an Exact Duplicate of another; the matching Photo may since have been archived or removed. */
  duplicateOfPhotoId?: string;
  archived: boolean;
  metadata?: PhotoMetadata;
  displayDimensions?: {
    width: number;
    height: number;
  };
  /** Present once processing has published this Photo as Ready. */
  chronology?: PhotoChronology;
  timelineThumbnails?: TimelineThumbnails;
  processingAttemptId?: string;
  processingStartedAt?: string;
  /** Upload-context-local calendar values derived once at upload time so reads never reinterpret them. */
  fileModifiedLocalDateTime?: string;
  uploadLocalDateTime: string;
  uploadContextTimeZone: string;
}

export interface PhotoChronology {
  original: {
    capturedAt: CapturedAt;
    source: OriginalCapturedAtSource;
  };
  active: {
    capturedAt: CapturedAt;
    source: CapturedAtSource;
    revision: number;
  };
}

export interface UploadBatch {
  uploadBatchId: string;
  userId: string;
  createdAt: string;
  photoIds: string[];
}

export interface SessionUser {
  userId: string;
  email: string;
}

export interface GetSessionResponse {
  signedIn: boolean;
  user?: SessionUser;
}

/**
 * Dispatched asynchronously through a private queue (ADR-0071): the response never varies
 * by allowlist membership, and verification looks a Sign-In Challenge up by Email Address
 * alone rather than by a public code identifier.
 */
export interface RequestSignInCodeRequest {
  email: string;
}

export interface RequestSignInCodeResponse {
  accepted: true;
}

export interface VerifySignInCodeRequest {
  email: string;
  code: string;
}

export interface VerifySignInCodeResponse {
  signedIn: true;
  user: SessionUser;
}

export interface CreateUploadBatchRequest {
  files: Array<{
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
    clientSha256?: string;
    fileModifiedAt?: string;
  }>;
  uploadContext: {
    timeZone: string;
  };
}

export interface CreateUploadBatchResponse {
  uploadBatchId: string;
  uploads: Array<{
    photoId: string;
    objectKey: string;
    uploadUrl: string;
    duplicate: boolean;
  }>;
}

export type ProcessingIssueReasonCode =
  | "finalProcessingFailure"
  | "metadataMismatch"
  | "unsupportedImage";

export interface UploadBatchPhotoStatus {
  photoId: string;
  fileName: string;
  processingState: ProcessingState;
  exactDuplicate: boolean;
  failureCode?: ProcessingIssueReasonCode;
  /** The "YYYY-MM" / "YYYY-unknown" navigation key for a Ready Photo, derived server-side from its active chronology. */
  timelineAnchor?: string;
  /** Present when this Photo is an Exact Duplicate and the matching Photo has been identified; may be absent if that Photo has since been archived. */
  duplicateOfPhotoId?: string;
}

export interface GetUploadBatchStatusResponse {
  uploadBatchId: string;
  counts: Record<ProcessingState, number>;
  photos: UploadBatchPhotoStatus[];
}

export interface RetryProcessingResponse {
  accepted: true;
  retryAttemptId: string;
}

export interface ProcessingIssue {
  photoId: string;
  fileName: string;
  reasonCode: ProcessingIssueReasonCode;
  status: "failed" | "retrying";
  addedAt: string;
  firstOpenedAt: string;
  attemptCount: number;
  lastAttemptAt: string;
}

export interface ListProcessingIssuesResponse {
  issues: ProcessingIssue[];
  nextCursor?: string;
}

export interface GetProcessingIssuesSummaryResponse {
  openCount: number;
}

export interface PhotoDetail {
  photoId: string;
  fileName: string;
  format: PhotoFormat;
  fileSizeBytes: number;
  processingState: ProcessingState;
  archived: boolean;
  metadata?: PhotoMetadata;
  displayDimensions?: {
    width: number;
    height: number;
  };
  /** Present once the Photo has chronology; the response ETag header carries chronology.active.revision. */
  chronology?: PhotoChronology;
}

export interface ArchiveMembershipResponse {
  photoId: string;
  archived: boolean;
}

export interface CapturedAtAdjustmentRequest {
  capturedAt: CapturedAt;
}

/** Full Photo detail, including chronology; the response ETag header carries the new revision. */
export type CapturedAtAdjustmentResponse = PhotoDetail;

export interface CreateTemporaryPhotoUrlResponse {
  url: string;
  expiresInSeconds: number;
}

export interface TimelineThumbnailSource {
  url: string;
  dimensions: Dimensions;
}

export interface TimelineThumbnailSources {
  large: TimelineThumbnailSource;
  /** Omitted when its actual width equals Large's (equal-width sources collapse to Large). */
  small?: TimelineThumbnailSource;
}

export interface TimelinePhoto {
  photoId: string;
  fileName: string;
  capturedAt: CapturedAt;
  addedAt: string;
  displayDimensions: Dimensions;
  timelineThumbnailSources: TimelineThumbnailSources;
}

export interface AnchorPeriod {
  year: number;
  /** Absent for the year's Date Unknown group. */
  month?: number;
}

export interface ListCollectionPhotosResponse {
  photos: TimelinePhoto[];
  nextCursor?: string;
  anchorPeriod?: AnchorPeriod;
  /** Conservative expiry shared by every Thumbnail source in this page; absent when the page is empty. */
  expiresAt?: string;
}

export interface AlbumNavigationYear {
  year: number;
  /** Keyed by "01"-"12" or "unknown"; zero counters are omitted. */
  counts: Record<string, number>;
}

export interface AlbumNavigationResponse {
  timeline: { years: AlbumNavigationYear[] };
  archive: { years: AlbumNavigationYear[] };
  processingIssueCount: number;
}

export interface TimelineThumbnailAccessRequest {
  photoIds: string[];
}

export interface TimelineThumbnailAccessResponse {
  photos: Array<{ photoId: string; timelineThumbnailSources: TimelineThumbnailSources }>;
  /** Conservative expiry shared by every renewed source in this response. */
  expiresAt: string;
}

export type PhotoCollection = "active" | "archived";

/** Stable, machine-readable codes carried alongside a human diagnostic message on error responses. */
export type AlbumErrorCode =
  | "empty_period"
  | "photo_collection_changed"
  | "chronology_changed"
  | "concurrent_projection_movement";

export interface AlbumErrorBody {
  code: AlbumErrorCode;
  message: string;
}

/** `photo_collection_changed`: the Photo's current collection differs from the one the Viewer requested. */
export interface PhotoCollectionChangedErrorBody extends AlbumErrorBody {
  code: "photo_collection_changed";
  currentCollection: PhotoCollection;
}

export interface ViewerBootstrapResponse {
  photoId: string;
  fileName: string;
  format: PhotoFormat;
  fileSizeBytes: number;
  metadata?: PhotoMetadata;
  displayDimensions: Dimensions;
  /** Original and active Captured At, source, and active chronology revision. */
  chronology: PhotoChronology;
  archived: boolean;
  /** The resolved Viewer Sequence collection: where this Photo actually lives right now. */
  collection: PhotoCollection;
  displayAccess: { url: string; expiresAt: string };
  /** Nearest newer neighbour in the resolved collection's live projection order, when present. */
  newerPhotoId?: string;
  /** Nearest older neighbour in the resolved collection's live projection order, when present. */
  olderPhotoId?: string;
}
