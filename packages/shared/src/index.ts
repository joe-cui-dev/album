export type PhotoFormat = "jpeg" | "png" | "heic";

export type CapturedAtSource = "exif" | "fileModifiedTime" | "uploadTime";

export type ProcessingState =
  | "uploadRequested"
  | "uploaded"
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
  uploadBatchId: string;
  originalObjectKey: string;
  displayObjectKey?: string;
  fileName: string;
  format: PhotoFormat;
  fileSizeBytes: number;
  sha256?: string;
  capturedAt?: string;
  capturedAtSource?: CapturedAtSource;
  processingState: ProcessingState;
  archived: boolean;
  metadata?: PhotoMetadata;
}

export interface UploadBatch {
  uploadBatchId: string;
  createdAt: string;
  photoIds: string[];
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

