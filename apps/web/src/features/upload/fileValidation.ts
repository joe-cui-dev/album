import {
  maxFilesPerUploadBatch,
  maxOriginalPhotoBytes,
  photoFormatForFile,
} from "@album/shared";

export interface FileValidationResult {
  valid: boolean;
  reason?: string;
}

export const maxUploadBatchFiles = maxFilesPerUploadBatch;

export const validatePhotoFile = (file: File): FileValidationResult => {
  if (file.size > maxOriginalPhotoBytes) {
    return { valid: false, reason: "50 MB maximum" };
  }

  if (!photoFormatForFile({ fileName: file.name, contentType: file.type })) {
    return { valid: false, reason: "JPEG, PNG, or HEIC photos only" };
  }

  return { valid: true };
};

export const validateUploadBatchFiles = (
  files: readonly File[],
): FileValidationResult => {
  if (files.length > maxUploadBatchFiles) {
    return {
      valid: false,
      reason: `Choose ${maxUploadBatchFiles} photos or fewer`,
    };
  }

  return { valid: true };
};
