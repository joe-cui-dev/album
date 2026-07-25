export const ORIGINALS_KEY_PREFIX = "originals/";
export const DISPLAY_KEY_PREFIX = "display/";
export const TIMELINE_THUMBNAILS_KEY_PREFIX = "timeline-thumbnails/";
const originalObjectKeyPattern = new RegExp(
  `^${ORIGINALS_KEY_PREFIX}([^/]+)/([^/]+)/([^/]+)$`,
);

export interface OriginalObjectKeyParts {
  userId: string;
  uploadBatchId: string;
  photoId: string;
}

export const buildOriginalObjectKey = ({
  userId,
  uploadBatchId,
  photoId,
}: OriginalObjectKeyParts): string =>
  `${ORIGINALS_KEY_PREFIX}${userId}/${uploadBatchId}/${photoId}`;

export const parseOriginalObjectKey = (
  objectKey: string,
): OriginalObjectKeyParts | undefined => {
  const match = originalObjectKeyPattern.exec(objectKey);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    userId: match[1],
    uploadBatchId: match[2],
    photoId: match[3],
  };
};

export const buildDisplayObjectKey = ({
  userId,
  photoId,
}: Pick<OriginalObjectKeyParts, "userId" | "photoId">): string =>
  `${DISPLAY_KEY_PREFIX}${userId}/${photoId}.jpg`;

export const buildTimelineThumbnailObjectKey = ({
  userId,
  photoId,
}: Pick<OriginalObjectKeyParts, "userId" | "photoId">): string =>
  `${TIMELINE_THUMBNAILS_KEY_PREFIX}${userId}/${photoId}.jpg`;

export const buildTimelineThumbnailLargeObjectKey = ({
  userId,
  photoId,
}: Pick<OriginalObjectKeyParts, "userId" | "photoId">): string =>
  `${TIMELINE_THUMBNAILS_KEY_PREFIX}${userId}/${photoId}-large.jpg`;

export const originalUploadMetadata = ({
  userId,
  uploadBatchId,
  photoId,
}: OriginalObjectKeyParts): Record<string, string> => ({
  "user-id": userId,
  "upload-batch-id": uploadBatchId,
  "photo-id": photoId,
});

export const matchesOriginalObjectMetadata = (
  metadata: Record<string, string | undefined>,
  { userId, uploadBatchId, photoId }: OriginalObjectKeyParts,
): boolean =>
  metadata["user-id"] === userId &&
  metadata["upload-batch-id"] === uploadBatchId &&
  metadata["photo-id"] === photoId;
