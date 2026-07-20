import type { CapturedAtSource } from "./chronology.js";

export type PhotoFormat = "jpeg" | "png" | "heic";

export const maxFilesPerUploadBatch = 100;
export const maxOriginalPhotoBytes = 50 * 1024 * 1024;
export const displayPhotoLongestEdgePixels = 2048;
export const timelineThumbnailLongestEdgePixels = 320;

export const supportedPhotoFormats = ["jpeg", "png", "heic"] as const;

export {
  ORIGINALS_KEY_PREFIX,
  buildDisplayObjectKey,
  buildOriginalObjectKey,
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

export type RetryProcessingResponse = UploadBatchPhotoStatus;

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
}

export type GetPhotoDetailResponse = PhotoDetail;

export interface ArchivePhotoResponse {
  photoId: string;
  archived: true;
}

export interface CreateTemporaryPhotoUrlResponse {
  url: string;
  expiresInSeconds: number;
}
