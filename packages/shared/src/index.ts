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
  ORIGINALS_KEY_PREFIX,
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
  timelineThumbnailObjectKey?: string;
  fileName: string;
  format: PhotoFormat;
  contentType?: string;
  fileSizeBytes: number;
  sha256?: string;
  clientSha256?: string;
  uploadRequestedAt?: string;
  fileModifiedAt?: string;
  capturedAt?: string;
  capturedAtSource?: CapturedAtSource;
  processingState: ProcessingState;
  failureCode?: string;
  failureMessage?: string;
  archived: boolean;
  metadata?: PhotoMetadata;
  displayDimensions?: {
    width: number;
    height: number;
  };
  timelineThumbnailDimensions?: {
    width: number;
    height: number;
  };
  /** Nested alongside the legacy flat capturedAt/capturedAtSource fields, which stay untouched for the v1 reader. */
  chronology?: PhotoChronology;
  timelineThumbnails?: TimelineThumbnails;
  processingAttemptId?: string;
  processingStartedAt?: string;
  migrationVersion?: number;
  /** Upload-context-local calendar values derived once at upload time so reads never reinterpret them. */
  fileModifiedLocalDateTime?: string;
  uploadLocalDateTime?: string;
  uploadContextTimeZone?: string;
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

export interface RequestSignInCodeRequest {
  email: string;
}

export interface RequestSignInCodeResponse {
  accepted: true;
  codeId?: string;
  devCode?: string;
}

export interface VerifySignInCodeRequest {
  email: string;
  codeId: string;
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
  /** Absent for old v1 clients, which stay on the explicit v1 compatibility path. */
  uploadContext?: {
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

export interface UploadBatchPhotoStatus {
  photoId: string;
  fileName: string;
  processingState: ProcessingState;
  exactDuplicate: boolean;
  failureCode?: string;
  failureMessage?: string;
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
  reasonCode: string;
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

export interface TimelinePhoto {
  photoId: string;
  fileName: string;
  capturedAt: string;
  processingState: ProcessingState;
  archived: boolean;
  displayObjectKey?: string;
  displayDimensions?: {
    width: number;
    height: number;
  };
  timelineThumbnailUrl?: string;
  timelineThumbnailDimensions?: {
    width: number;
    height: number;
  };
}

export interface ListTimelinePhotosResponse {
  photos: TimelinePhoto[];
}

export interface PhotoDetail {
  photoId: string;
  fileName: string;
  format: PhotoFormat;
  fileSizeBytes: number;
  capturedAt?: string;
  capturedAtSource?: CapturedAtSource;
  processingState: ProcessingState;
  archived: boolean;
  metadata?: PhotoMetadata;
  displayDimensions?: {
    width: number;
    height: number;
  };
  /** Present once the Photo has v2 chronology; the response ETag header carries chronology.active.revision. */
  chronology?: PhotoChronology;
}

export type GetPhotoDetailResponse = PhotoDetail;

export interface ArchivePhotoResponse {
  photoId: string;
  archived: true;
}

export interface ArchiveMembershipResponse {
  photoId: string;
  archived: boolean;
}

export interface CapturedAtAdjustmentRequest {
  capturedAt: CapturedAt;
}

/** Full Photo detail, including chronology; the response ETag header carries the new revision. */
export type CapturedAtAdjustmentResponse = GetPhotoDetailResponse;

export interface CreateTemporaryPhotoUrlResponse {
  url: string;
  expiresInSeconds: number;
}

export interface TimelineThumbnailSourceV2 {
  url: string;
  dimensions: Dimensions;
}

export interface TimelineThumbnailSourcesV2 {
  large: TimelineThumbnailSourceV2;
  /** Omitted when its actual width equals Large's (equal-width sources collapse to Large). */
  small?: TimelineThumbnailSourceV2;
}

export interface TimelinePhotoV2 {
  photoId: string;
  fileName: string;
  capturedAt: CapturedAt;
  addedAt: string;
  displayDimensions: Dimensions;
  timelineThumbnailSources: TimelineThumbnailSourcesV2;
}

export interface AnchorPeriod {
  year: number;
  /** Absent for the year's Date Unknown group. */
  month?: number;
}

export interface ListCollectionPhotosV2Response {
  photos: TimelinePhotoV2[];
  nextCursor?: string;
  anchorPeriod?: AnchorPeriod;
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
  photos: Array<{ photoId: string; timelineThumbnailSources: TimelineThumbnailSourcesV2 }>;
}
