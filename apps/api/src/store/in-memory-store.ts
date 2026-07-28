import { isSameCapturedAt, type CapturedAt, type Photo, type UploadBatch } from "@album/shared";
import { ConcurrentPhotoModificationError, ProcessingAttemptConflictError, StaleChronologyRevisionError } from "./errors.js";
import type {
  DateIndexPeriodCounts,
  PersonalAlbum,
  PersonalAlbumStore,
  PhotoCollection,
  ProcessingIssueRecord,
  TimelineProjection,
} from "./personal-album.js";
import {
  dateIndexPeriodSegment,
  dateIndexPrefix,
  dateIndexSortKey,
  dateIndexYear,
  omitZeroCounts,
  timelineProjectionPrefix,
  timelineProjectionSortKey,
} from "./projection-keys.js";

export const createInMemoryPersonalAlbumStore = (): PersonalAlbumStore => {
  const photosByUser = new Map<string, Map<string, Photo>>();
  const uploadBatchesByUser = new Map<string, Map<string, UploadBatch>>();
  const projectionsByUser = new Map<string, Map<string, TimelineProjection>>();
  const dateIndexByUser = new Map<string, Map<string, DateIndexPeriodCounts>>();
  const issuesByUser = new Map<string, Map<string, ProcessingIssueRecord>>();
  const issueSummaryByUser = new Map<string, number>();

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
  const projectionsOf = (userId: string): Map<string, TimelineProjection> => {
    let projections = projectionsByUser.get(userId);
    if (!projections) {
      projections = new Map();
      projectionsByUser.set(userId, projections);
    }
    return projections;
  };
  const dateIndexOf = (userId: string): Map<string, DateIndexPeriodCounts> => {
    let index = dateIndexByUser.get(userId);
    if (!index) {
      index = new Map();
      dateIndexByUser.set(userId, index);
    }
    return index;
  };
  const issuesOf = (userId: string): Map<string, ProcessingIssueRecord> => {
    let issues = issuesByUser.get(userId);
    if (!issues) {
      issues = new Map();
      issuesByUser.set(userId, issues);
    }
    return issues;
  };

  const writeProjection = (
    userId: string,
    projection: TimelineProjection,
  ): void => {
    projectionsOf(userId).set(
      timelineProjectionSortKey({
        collection: projection.collection,
        capturedAt: projection.capturedAt,
        addedAt: projection.addedAt,
        photoId: projection.photoId,
      }),
      projection,
    );
  };

  const deleteProjection = (
    userId: string,
    input: { collection: PhotoCollection; capturedAt: CapturedAt; addedAt: string; photoId: string },
  ): void => {
    projectionsOf(userId).delete(timelineProjectionSortKey(input));
  };

  const incrementDateIndex = (
    userId: string,
    collection: PhotoCollection,
    capturedAt: CapturedAt,
    delta: number,
  ): void => {
    const key = dateIndexSortKey({ collection, year: dateIndexYear(capturedAt) });
    const period = dateIndexPeriodSegment(capturedAt);
    const counts = dateIndexOf(userId).get(key) ?? {};
    const nextValue = (counts[period] ?? 0) + delta;
    if (nextValue < 0) {
      throw new Error(`Date Index counter would go negative for ${key}/${period}`);
    }
    if (nextValue === 0) {
      delete counts[period];
    } else {
      counts[period] = nextValue;
    }
    dateIndexOf(userId).set(key, counts);
  };

  const incrementIssueSummary = (userId: string, delta: number): void => {
    const next = (issueSummaryByUser.get(userId) ?? 0) + delta;
    if (next < 0) {
      throw new Error(`Processing Issues open count would go negative for ${userId}`);
    }
    issueSummaryByUser.set(userId, next);
  };

  const resolveIssue = (userId: string, photoId: string): void => {
    if (issuesOf(userId).delete(photoId)) {
      incrementIssueSummary(userId, -1);
    }
  };

  const requirePhoto = (userId: string, photoId: string): Photo => {
    const candidate = photosOf(userId).get(photoId);
    if (!candidate) {
      throw new Error(`Photo not found: ${photoId}`);
    }
    return candidate;
  };

  const assertAttemptOwnership = (candidate: Photo, attemptId: string | undefined): void => {
    if (candidate.permanentDeletionReservationId) {
      throw new ConcurrentPhotoModificationError(candidate.photoId);
    }
    if (attemptId !== undefined && candidate.processingAttemptId !== attemptId) {
      throw new ProcessingAttemptConflictError(candidate.photoId);
    }
  };

  const clearProcessingAttempt = (candidate: Photo): void => {
    delete candidate.processingAttemptId;
    delete candidate.processingStartedAt;
  };

  const requireReadyPhoto = (
    candidate: Photo,
  ): { chronology: NonNullable<Photo["chronology"]>; addedAt: string; timelineThumbnails: NonNullable<Photo["timelineThumbnails"]> } => {
    if (
      candidate.processingState !== "ready" ||
      !candidate.chronology ||
      !candidate.uploadRequestedAt ||
      !candidate.timelineThumbnails
    ) {
      throw new Error(`Photo ${candidate.photoId} has no Timeline projection`);
    }
    return {
      chronology: candidate.chronology,
      addedAt: candidate.uploadRequestedAt,
      timelineThumbnails: candidate.timelineThumbnails,
    };
  };

  return {
    async queryExpiredTrashedPhotos({ before, limit, cursor }) {
      const entries = [...projectionsByUser.entries()]
        .flatMap(([userId, projections]) => [...projections.values()].map((projection) => ({ userId, projection })))
        .filter(({ projection }) => projection.collection === "trashed" && projection.deletedAt !== undefined && projection.deletedAt <= before)
        .map(({ userId, projection }) => ({
          userId,
          photoId: projection.photoId,
          sortKey: `${projection.deletedAt}#${userId}#${projection.photoId}`,
        }))
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
        .filter((entry) => cursor === undefined || entry.sortKey > cursor);
      const page = entries.slice(0, limit);
      return {
        photos: page.map(({ userId, photoId }) => ({ userId, photoId })),
        ...(page.length === limit && page.length > 0 ? { nextCursor: page[page.length - 1]!.sortKey } : {}),
      };
    },
    personalAlbumOf(userId): PersonalAlbum {
      const photo = (photoId: string): Photo | undefined => photosOf(userId).get(photoId);
      return {
        async getPhoto(photoId) {
          return photo(photoId);
        },
        async getUploadBatch(uploadBatchId) {
          return uploadBatchesOf(userId).get(uploadBatchId);
        },
        async findReadyPhotoBySha256({ sha256, excludePhotoId }) {
          const match = [...photosOf(userId).values()].find(
            (candidate) =>
              candidate.photoId !== excludePhotoId &&
              candidate.sha256 === sha256 &&
              candidate.processingState === "ready" && !candidate.trashed,
          );
          return match ? { photoId: match.photoId } : undefined;
        },
        async createPhoto(input) {
          photosOf(userId).set(input.photoId, {
            ...input,
            userId,
            processingState: "uploadRequested",
            trashed: false,
          });
        },
        async createUploadBatch(input) {
          uploadBatchesOf(userId).set(input.uploadBatchId, { ...input, userId });
        },
        async markProcessingStarted(photoId) {
          const candidate = photo(photoId);
          if (candidate) {
            if (candidate.permanentDeletionReservationId) throw new ConcurrentPhotoModificationError(photoId);
            candidate.processingState = "processing";
            delete candidate.failureCode;
          }
        },
        async publishReadyPhoto(input) {
          const candidate = requirePhoto(userId, input.photoId);
          assertAttemptOwnership(candidate, input.attemptId);
          const addedAt = candidate.uploadRequestedAt;
          if (!addedAt) {
            throw new Error(`Photo ${input.photoId} has no uploadRequestedAt (Added At)`);
          }

          Object.assign(candidate, {
            processingState: "ready",
            sha256: input.sha256,
            fileName: input.fileName,
            displayObjectKey: input.displayObjectKey,
            displayDimensions: input.displayDimensions,
            timelineThumbnails: input.timelineThumbnails,
            metadata: input.metadata,
            chronology: {
              original: {
                capturedAt: input.originalCapturedAt,
                source: input.originalCapturedAtSource,
              },
              active: {
                capturedAt: input.originalCapturedAt,
                source: input.originalCapturedAtSource,
                revision: 0,
              },
            },
          });
          delete candidate.failureCode;
          clearProcessingAttempt(candidate);

          writeProjection(userId, {
            photoId: input.photoId,
            collection: "active",
            capturedAt: input.originalCapturedAt,
            addedAt,
            fileName: input.fileName,
            displayDimensions: input.displayDimensions,
            timelineThumbnails: input.timelineThumbnails,
          });
          incrementDateIndex(userId, "active", input.originalCapturedAt, 1);

          if (input.hadOpenProcessingIssue) {
            resolveIssue(userId, input.photoId);
          }
        },

        async publishExactDuplicate(input) {
          const candidate = requirePhoto(userId, input.photoId);
          assertAttemptOwnership(candidate, input.attemptId);

          candidate.processingState = "exactDuplicate";
          candidate.sha256 = input.sha256;
          Object.assign(candidate, { duplicateOfPhotoId: input.duplicateOfPhotoId });
          delete candidate.failureCode;
          clearProcessingAttempt(candidate);

          if (input.hadOpenProcessingIssue) {
            resolveIssue(userId, input.photoId);
          }
        },

        async setTrashMembership({ photoId, trashed }) {
          const candidate = requirePhoto(userId, photoId);
          const { chronology, addedAt, timelineThumbnails } = requireReadyPhoto(candidate);
          if (candidate.trashed === trashed) {
            return;
          }
          if (candidate.permanentDeletionReservationId) {
            throw new ConcurrentPhotoModificationError(photoId);
          }

          const fromCollection: PhotoCollection = candidate.trashed ? "trashed" : "active";
          const toCollection: PhotoCollection = trashed ? "trashed" : "active";
          const capturedAt = chronology.active.capturedAt;
          const deletedAt = trashed ? new Date().toISOString() : undefined;

          deleteProjection(userId, { collection: fromCollection, capturedAt, addedAt, photoId });
          writeProjection(userId, {
            photoId,
            collection: toCollection,
            capturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails,
            ...(deletedAt ? { deletedAt } : {}),
          });
          incrementDateIndex(userId, fromCollection, capturedAt, -1);
          incrementDateIndex(userId, toCollection, capturedAt, 1);
          candidate.trashed = trashed;
          if (deletedAt) candidate.deletedAt = deletedAt;
          else delete candidate.deletedAt;
        },

        async reservePermanentDeletion({ photo: expected, reservationId }) {
          const candidate = photo(expected.photoId);
          if (!candidate) return false;
          const unchanged =
            candidate.processingState === expected.processingState &&
            candidate.trashed === expected.trashed &&
            candidate.deletedAt === expected.deletedAt &&
            candidate.chronology?.active.revision === expected.chronology?.active.revision;
          if (!unchanged) throw new ConcurrentPhotoModificationError(expected.photoId);
          candidate.permanentDeletionReservationId = reservationId;
          return true;
        },

        async permanentlyDeletePhoto({ photo: expected, reservationId }) {
          const candidate = photo(expected.photoId);
          if (!candidate) return;
          const unchanged =
            candidate.processingState === expected.processingState &&
            candidate.trashed === expected.trashed &&
            candidate.deletedAt === expected.deletedAt &&
            candidate.chronology?.active.revision === expected.chronology?.active.revision &&
            candidate.permanentDeletionReservationId === reservationId;
          if (!unchanged) throw new ConcurrentPhotoModificationError(expected.photoId);

          if (candidate.processingState === "ready") {
            const { chronology, addedAt } = requireReadyPhoto(candidate);
            deleteProjection(userId, {
              collection: "trashed",
              capturedAt: chronology.active.capturedAt,
              addedAt,
              photoId: candidate.photoId,
            });
            incrementDateIndex(userId, "trashed", chronology.active.capturedAt, -1);
          } else if (candidate.processingState === "processingFailed") {
            resolveIssue(userId, candidate.photoId);
          } else {
            throw new Error(`Photo ${candidate.photoId} is not eligible for Permanent Deletion`);
          }
          photosOf(userId).delete(candidate.photoId);
        },

        async replaceActiveChronology({ photoId, capturedAt, expectedRevision }) {
          const candidate = requirePhoto(userId, photoId);
          if (candidate.permanentDeletionReservationId) throw new ConcurrentPhotoModificationError(photoId);
          const { chronology, addedAt, timelineThumbnails } = requireReadyPhoto(candidate);
          if (chronology.active.revision !== expectedRevision) {
            throw new StaleChronologyRevisionError(photoId);
          }

          const current = chronology.active;
          if (current.source === "userAdjusted" && isSameCapturedAt(current.capturedAt, capturedAt)) {
            return { revision: current.revision };
          }

          const collection: PhotoCollection = candidate.trashed ? "trashed" : "active";
          deleteProjection(userId, { collection, capturedAt: current.capturedAt, addedAt, photoId });
          writeProjection(userId, {
            photoId,
            collection,
            capturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails,
            ...(candidate.trashed && candidate.deletedAt ? { deletedAt: candidate.deletedAt } : {}),
          });
          incrementDateIndex(userId, collection, current.capturedAt, -1);
          incrementDateIndex(userId, collection, capturedAt, 1);

          chronology.active = { capturedAt, source: "userAdjusted", revision: current.revision + 1 };
          return { revision: chronology.active.revision };
        },

        async revertActiveChronology({ photoId, expectedRevision }) {
          const candidate = requirePhoto(userId, photoId);
          if (candidate.permanentDeletionReservationId) throw new ConcurrentPhotoModificationError(photoId);
          const { chronology, addedAt, timelineThumbnails } = requireReadyPhoto(candidate);
          if (chronology.active.revision !== expectedRevision) {
            throw new StaleChronologyRevisionError(photoId);
          }

          const current = chronology.active;
          const original = chronology.original;
          if (
            current.source === original.source &&
            isSameCapturedAt(current.capturedAt, original.capturedAt)
          ) {
            return { revision: current.revision };
          }

          const collection: PhotoCollection = candidate.trashed ? "trashed" : "active";
          deleteProjection(userId, { collection, capturedAt: current.capturedAt, addedAt, photoId });
          writeProjection(userId, {
            photoId,
            collection,
            capturedAt: original.capturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails,
            ...(candidate.trashed && candidate.deletedAt ? { deletedAt: candidate.deletedAt } : {}),
          });
          incrementDateIndex(userId, collection, current.capturedAt, -1);
          incrementDateIndex(userId, collection, original.capturedAt, 1);

          chronology.active = {
            capturedAt: original.capturedAt,
            source: original.source,
            revision: current.revision + 1,
          };
          return { revision: chronology.active.revision };
        },

        async recordProcessingIssue({ photoId, fileName, reasonCode, attemptedAt, attemptId }) {
          const candidate = requirePhoto(userId, photoId);
          assertAttemptOwnership(candidate, attemptId);

          candidate.processingState = "processingFailed";
          candidate.failureCode = reasonCode;
          clearProcessingAttempt(candidate);

          const issues = issuesOf(userId);
          const existing = issues.get(photoId);
          if (existing) {
            existing.status = "failed";
            existing.attemptCount += 1;
            existing.lastAttemptAt = attemptedAt;
            existing.reasonCode = reasonCode;
            delete existing.retryAttemptId;
          } else {
            issues.set(photoId, {
              photoId,
              fileName,
              reasonCode,
              status: "failed",
              addedAt: candidate.uploadRequestedAt!,
              firstOpenedAt: attemptedAt,
              attemptCount: 1,
              lastAttemptAt: attemptedAt,
            });
            incrementIssueSummary(userId, 1);
          }
        },

        async getProcessingIssue(photoId) {
          return issuesOf(userId).get(photoId);
        },

        async beginProcessingIssueRetry({ photoId, retryAttemptId, attemptedAt }) {
          const candidate = requirePhoto(userId, photoId);
          const issue = issuesOf(userId).get(photoId);
          if (!issue || candidate.processingState !== "processingFailed") {
            throw new Error(`Photo ${photoId} has no open Processing Issue`);
          }
          if (issue.retryAttemptId && issue.retryAttemptId !== retryAttemptId) {
            return { retryAttemptId: issue.retryAttemptId };
          }
          issue.status = "retrying";
          issue.retryAttemptId = retryAttemptId;
          delete issue.retryReservationExpiresAt;
          issue.lastAttemptAt = attemptedAt;
          return { retryAttemptId };
        },

        async reserveProcessingIssueRetry({ photoId, retryAttemptId, reservedAt, reservationExpiresAt }) {
          const candidate = requirePhoto(userId, photoId);
          const issue = issuesOf(userId).get(photoId);
          if (!issue || candidate.processingState !== "processingFailed") {
            throw new Error(`Photo ${photoId} has no open Processing Issue`);
          }
          if (
            issue.retryAttemptId &&
            (issue.status === "retrying" ||
              (issue.retryReservationExpiresAt !== undefined && issue.retryReservationExpiresAt >= reservedAt))
          ) return { retryAttemptId: issue.retryAttemptId };
          issue.retryAttemptId = retryAttemptId;
          issue.retryReservationExpiresAt = reservationExpiresAt;
          return { retryAttemptId };
        },

        async releaseProcessingIssueRetry({ photoId, retryAttemptId }) {
          const issue = issuesOf(userId).get(photoId);
          if (issue?.status === "failed" && issue.retryAttemptId === retryAttemptId) {
            delete issue.retryAttemptId;
            delete issue.retryReservationExpiresAt;
          }
        },

        async queryProcessingIssues({ limit, after }) {
          const entries = [...issuesOf(userId).values()]
            .map((issue) => ({
              issue,
              sortKey: `PROCESSING_ISSUE#${issue.addedAt}#${issue.photoId}`,
            }))
            .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
            .filter(({ sortKey }) => !after || sortKey < after.sortKey);
          const page = entries.slice(0, limit);
          return {
            issues: page.map(({ issue }) => issue),
            ...(page.length === limit && page.length > 0
              ? { lastSortKey: page[page.length - 1]!.sortKey }
              : {}),
          };
        },

        async claimProcessingAttempt({ photoId, attemptId, startedAt }) {
          const candidate = requirePhoto(userId, photoId);
          if (candidate.permanentDeletionReservationId) throw new ConcurrentPhotoModificationError(photoId);
          const issue = issuesOf(userId).get(photoId);
          if (
            issue?.retryAttemptId !== undefined &&
            issue.retryAttemptId !== undefined &&
            issue.retryAttemptId !== attemptId
          ) {
            throw new ProcessingAttemptConflictError(photoId);
          }
          if (candidate.processingAttemptId === attemptId) {
            candidate.processingState = "processing";
            return "resumed";
          }
          if (candidate.processingAttemptId !== undefined) {
            throw new ProcessingAttemptConflictError(photoId);
          }
          candidate.processingAttemptId = attemptId;
          candidate.processingStartedAt = startedAt;
          candidate.processingState = "processing";
          return "claimed";
        },

        async getTimelineProjections(collection) {
          return [...projectionsOf(userId).values()].filter(
            (projection) => projection.collection === collection,
          );
        },

        async getDateIndex(collection, year) {
          return omitZeroCounts({ ...(dateIndexOf(userId).get(dateIndexSortKey({ collection, year })) ?? {}) });
        },

        async queryTimelinePage({ collection, limit, after, atOrBefore }) {
          const prefix = timelineProjectionPrefix(collection);
          const entries = [...projectionsOf(userId).entries()]
            .filter(([sk]) => sk.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
          const bounded = entries.filter(([sk]) => {
            if (atOrBefore) {
              return sk <= atOrBefore.sortKey;
            }
            if (after) {
              return sk < after.sortKey;
            }
            return true;
          });
          const page = bounded.slice(0, limit);
          return {
            projections: page.map(([, projection]) => projection),
            ...(page.length === limit && page.length > 0
              ? { lastSortKey: page[page.length - 1]![0] }
              : {}),
          };
        },

        async queryAdjacentProjection({ collection, capturedAt, addedAt, photoId, direction }) {
          const sortKey = timelineProjectionSortKey({ collection, capturedAt, addedAt, photoId });
          const prefix = timelineProjectionPrefix(collection);
          const entries = [...projectionsOf(userId).entries()]
            .filter(([sk]) => sk.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
          if (direction === "newer") {
            return entries.find(([sk]) => sk > sortKey)?.[1];
          }
          return [...entries].reverse().find(([sk]) => sk < sortKey)?.[1];
        },

        async listDateIndexYears(collection) {
          const prefix = dateIndexPrefix(collection);
          return [...dateIndexOf(userId).entries()]
            .filter(([sk]) => sk.startsWith(prefix))
            .map(([sk, counts]) => ({ year: Number(sk.slice(prefix.length)), counts: omitZeroCounts(counts) }))
            .filter(({ counts }) => Object.keys(counts).length > 0)
            .sort((a, b) => a.year - b.year);
        },

        async getProcessingIssuesSummary() {
          return issueSummaryByUser.get(userId) ?? 0;
        },

        async getPhotosByIds(photoIds) {
          return photoIds
            .map((photoId) => photosOf(userId).get(photoId))
            .filter((candidate): candidate is Photo => candidate !== undefined);
        },
      };
    },
  };
};
