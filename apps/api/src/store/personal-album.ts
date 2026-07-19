import type {
  CapturedAtSource,
  Photo,
  PhotoFormat,
  PhotoMetadata,
  ProcessingState,
  UploadBatch,
} from "@album/shared";

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
}
