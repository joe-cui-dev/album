import type { Photo, UploadBatch } from "@album/shared";
import type { PersonalAlbum, PersonalAlbumStore } from "./personal-album.js";

export const createInMemoryPersonalAlbumStore = (): PersonalAlbumStore => {
  const photosByUser = new Map<string, Map<string, Photo>>();
  const uploadBatchesByUser = new Map<string, Map<string, UploadBatch>>();
  const timelinePhotoIdsByUser = new Map<string, Map<string, string>>();

  const photosOf = (userId: string): Map<string, Photo> => {
    let photos = photosByUser.get(userId);
    if (!photos) {
      photos = new Map();
      photosByUser.set(userId, photos);
    }
    return photos;
  };
  const uploadBatchesOf = (userId: string): Map<string, UploadBatch> => {
    let batches = uploadBatchesByUser.get(userId);
    if (!batches) {
      batches = new Map();
      uploadBatchesByUser.set(userId, batches);
    }
    return batches;
  };
  const timelineOf = (userId: string): Map<string, string> => {
    let timeline = timelinePhotoIdsByUser.get(userId);
    if (!timeline) {
      timeline = new Map();
      timelinePhotoIdsByUser.set(userId, timeline);
    }
    return timeline;
  };

  return {
    personalAlbumOf(userId): PersonalAlbum {
      const photo = (photoId: string): Photo | undefined => photosOf(userId).get(photoId);
      return {
        async getPhoto(photoId) {
          return photo(photoId);
        },
        async getUploadBatch(uploadBatchId) {
          return uploadBatchesOf(userId).get(uploadBatchId);
        },
        async listTimelinePhotos(input) {
          return [...timelineOf(userId).entries()]
            .map(([, photoId]) => photosOf(userId).get(photoId))
            .filter((candidate): candidate is Photo => candidate !== undefined)
            .filter(
              (candidate) =>
                !input.fromCapturedAt || candidate.capturedAt! >= input.fromCapturedAt,
            )
            .filter(
              (candidate) =>
                !input.toCapturedAt || candidate.capturedAt! <= input.toCapturedAt,
            )
            .filter(
              (candidate) =>
                input.processingState === undefined ||
                candidate.processingState === input.processingState,
            )
            .filter(
              (candidate) =>
                input.archived === undefined || candidate.archived === input.archived,
            )
            .sort((left, right) => right.capturedAt!.localeCompare(left.capturedAt!));
        },
        async findReadyPhotoBySha256({ sha256, excludePhotoId }) {
          const match = [...photosOf(userId).values()].find(
            (candidate) =>
              candidate.photoId !== excludePhotoId &&
              candidate.sha256 === sha256 &&
              candidate.processingState === "ready",
          );
          return match ? { photoId: match.photoId } : undefined;
        },
        async createPhoto(input) {
          photosOf(userId).set(input.photoId, {
            ...input,
            userId,
            processingState: "uploadRequested",
            archived: false,
          });
        },
        async createUploadBatch(input) {
          uploadBatchesOf(userId).set(input.uploadBatchId, { ...input, userId });
        },
        async markProcessingStarted(photoId) {
          const candidate = photo(photoId);
          if (candidate) {
            candidate.processingState = "processing";
            delete candidate.failureCode;
            delete candidate.failureMessage;
          }
        },
        async markProcessingFailed({ photoId, failureCode, failureMessage }) {
          const candidate = photo(photoId);
          if (candidate) {
            candidate.processingState = "processingFailed";
            candidate.failureCode = failureCode;
            candidate.failureMessage = failureMessage;
          }
        },
        async markExactDuplicate({ photoId, sha256, duplicateOfPhotoId }) {
          const candidate = photo(photoId);
          if (candidate) {
            candidate.processingState = "exactDuplicate";
            candidate.sha256 = sha256;
            Object.assign(candidate, { duplicateOfPhotoId });
            delete candidate.failureCode;
            delete candidate.failureMessage;
          }
        },
        async markReady(input) {
          const candidate = photo(input.photoId);
          if (candidate) {
            Object.assign(candidate, {
              processingState: "ready",
              sha256: input.sha256,
              displayObjectKey: input.displayObjectKey,
              displayDimensions: input.displayDimensions,
              timelineThumbnailObjectKey: input.timelineThumbnailObjectKey,
              timelineThumbnailDimensions: input.timelineThumbnailDimensions,
              capturedAt: input.capturedAt,
              capturedAtSource: input.capturedAtSource,
              metadata: input.metadata,
            });
            delete candidate.failureCode;
            delete candidate.failureMessage;
            timelineOf(userId).set(
              `TIMELINE#${input.capturedAt}#${input.photoId}`,
              input.photoId,
            );
          }
        },
        async archivePhoto(photoId) {
          const candidate = photo(photoId);
          if (candidate) {
            candidate.archived = true;
          }
        },
      };
    },
  };
};
