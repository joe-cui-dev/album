export interface FileValidationResult {
  valid: boolean;
  reason?: string;
}

const maxOriginalPhotoBytes = 50 * 1024 * 1024;

export const validatePhotoFile = (file: File): FileValidationResult => {
  if (file.size > maxOriginalPhotoBytes) {
    return { valid: false, reason: "50 MB maximum" };
  }

  if (!isSupportedPhoto(file)) {
    return { valid: false, reason: "JPEG, PNG, or HEIC photos only" };
  }

  return { valid: true };
};

const isSupportedPhoto = (file: File): boolean => {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type === "image/jpeg") {
    return extension === "jpg" || extension === "jpeg";
  }

  if (file.type === "image/png") {
    return extension === "png";
  }

  if (file.type === "image/heic" || file.type === "image/heif") {
    return extension === "heic" || extension === "heif";
  }

  return false;
};
