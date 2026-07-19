export const ORIGINALS_KEY_PREFIX = "originals/";
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
  `display/${userId}/${photoId}.jpg`;

export const buildTimelineThumbnailObjectKey = ({
  userId,
  photoId,
}: Pick<OriginalObjectKeyParts, "userId" | "photoId">): string =>
  `timeline-thumbnails/${userId}/${photoId}.jpg`;

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
