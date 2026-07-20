import { isSameCapturedAt, type CapturedAt, type Photo, type UploadBatch } from "@album/shared";
import { ProcessingAttemptConflictError, StaleChronologyRevisionError } from "./errors.js";
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
} from "./v2-keys.js";

export const createInMemoryPersonalAlbumStore = (): PersonalAlbumStore => {
  const photosByUser = new Map<string, Map<string, Photo>>();
  const uploadBatchesByUser = new Map<string, Map<string, UploadBatch>>();
  const timelinePhotoIdsByUser = new Map<string, Map<string, string>>();
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
  const timelineOf = (userId: string): Map<string, string> => {
    let timeline = timelinePhotoIdsByUser.get(userId);
    if (!timeline) {
      timeline = new Map();
      timelinePhotoIdsByUser.set(userId, timeline);
    }
    return timeline;
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
    if (attemptId !== undefined && candidate.processingAttemptId !== attemptId) {
      throw new ProcessingAttemptConflictError(candidate.photoId);
    }
  };

  const clearProcessingAttempt = (candidate: Photo): void => {
    delete candidate.processingAttemptId;
    delete candidate.processingStartedAt;
  };

  const requireV2Ready = (
    candidate: Photo,
  ): { chronology: NonNullable<Photo["chronology"]>; addedAt: string; timelineThumbnails: NonNullable<Photo["timelineThumbnails"]> } => {
    if (
      candidate.processingState !== "ready" ||
      !candidate.chronology ||
      !candidate.uploadRequestedAt ||
      !candidate.timelineThumbnails
    ) {
      throw new Error(`Photo ${candidate.photoId} has no v2 Timeline projection`);
    }
    return {
      chronology: candidate.chronology,
      addedAt: candidate.uploadRequestedAt,
      timelineThumbnails: candidate.timelineThumbnails,
    };
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

        async publishReadyPhotoV2(input) {
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
          delete candidate.failureMessage;
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

        async publishExactDuplicateV2(input) {
          const candidate = requirePhoto(userId, input.photoId);
          assertAttemptOwnership(candidate, input.attemptId);

          candidate.processingState = "exactDuplicate";
          candidate.sha256 = input.sha256;
          Object.assign(candidate, { duplicateOfPhotoId: input.duplicateOfPhotoId });
          delete candidate.failureCode;
          delete candidate.failureMessage;
          clearProcessingAttempt(candidate);

          if (input.hadOpenProcessingIssue) {
            resolveIssue(userId, input.photoId);
          }
        },

        async setArchiveMembershipV2({ photoId, archived }) {
          const candidate = requirePhoto(userId, photoId);
          const { chronology, addedAt, timelineThumbnails } = requireV2Ready(candidate);
          if (candidate.archived === archived) {
            return;
          }

          const fromCollection: PhotoCollection = candidate.archived ? "archived" : "active";
          const toCollection: PhotoCollection = archived ? "archived" : "active";
          const capturedAt = chronology.active.capturedAt;

          deleteProjection(userId, { collection: fromCollection, capturedAt, addedAt, photoId });
          writeProjection(userId, {
            photoId,
            collection: toCollection,
            capturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails,
          });
          incrementDateIndex(userId, fromCollection, capturedAt, -1);
          incrementDateIndex(userId, toCollection, capturedAt, 1);
          candidate.archived = archived;
        },

        async replaceActiveChronologyV2({ photoId, capturedAt, expectedRevision }) {
          const candidate = requirePhoto(userId, photoId);
          const { chronology, addedAt, timelineThumbnails } = requireV2Ready(candidate);
          if (chronology.active.revision !== expectedRevision) {
            throw new StaleChronologyRevisionError(photoId);
          }

          const current = chronology.active;
          if (current.source === "userAdjusted" && isSameCapturedAt(current.capturedAt, capturedAt)) {
            return { revision: current.revision };
          }

          const collection: PhotoCollection = candidate.archived ? "archived" : "active";
          deleteProjection(userId, { collection, capturedAt: current.capturedAt, addedAt, photoId });
          writeProjection(userId, {
            photoId,
            collection,
            capturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails,
          });
          incrementDateIndex(userId, collection, current.capturedAt, -1);
          incrementDateIndex(userId, collection, capturedAt, 1);

          chronology.active = { capturedAt, source: "userAdjusted", revision: current.revision + 1 };
          return { revision: chronology.active.revision };
        },

        async revertActiveChronologyV2({ photoId, expectedRevision }) {
          const candidate = requirePhoto(userId, photoId);
          const { chronology, addedAt, timelineThumbnails } = requireV2Ready(candidate);
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

          const collection: PhotoCollection = candidate.archived ? "archived" : "active";
          deleteProjection(userId, { collection, capturedAt: current.capturedAt, addedAt, photoId });
          writeProjection(userId, {
            photoId,
            collection,
            capturedAt: original.capturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails,
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

        async recordProcessingIssueV2({ photoId, fileName, reasonCode, attemptedAt, attemptId }) {
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

        async beginProcessingIssueRetryV2({ photoId, retryAttemptId, attemptedAt }) {
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

        async reserveProcessingIssueRetryV2({ photoId, retryAttemptId, reservedAt, reservationExpiresAt }) {
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

        async releaseProcessingIssueRetryV2({ photoId, retryAttemptId }) {
          const issue = issuesOf(userId).get(photoId);
          if (issue?.status === "failed" && issue.retryAttemptId === retryAttemptId) {
            delete issue.retryAttemptId;
            delete issue.retryReservationExpiresAt;
          }
        },

        async queryProcessingIssuesV2({ limit, after }) {
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

        async applyMigrationVersionV2(input) {
          const candidate = requirePhoto(userId, input.photoId);
          if (candidate.processingState !== "ready") {
            throw new Error(`Photo ${input.photoId} is not Ready; cannot migrate`);
          }
          if ((candidate.migrationVersion ?? 0) >= input.migrationVersion) {
            return;
          }
          const addedAt = candidate.uploadRequestedAt;
          if (!addedAt) {
            throw new Error(`Photo ${input.photoId} has no uploadRequestedAt (Added At)`);
          }

          const alreadyMigrated = candidate.chronology !== undefined;
          const chronology =
            candidate.chronology ??
            {
              original: {
                capturedAt: input.originalCapturedAt,
                source: input.originalCapturedAtSource,
              },
              active: {
                capturedAt: input.originalCapturedAt,
                source: input.originalCapturedAtSource,
                revision: 0,
              },
            };
          candidate.chronology = chronology;
          candidate.timelineThumbnails = input.timelineThumbnails;
          candidate.migrationVersion = input.migrationVersion;

          const collection: PhotoCollection = candidate.archived ? "archived" : "active";
          const activeCapturedAt = chronology.active.capturedAt;
          writeProjection(userId, {
            photoId: input.photoId,
            collection,
            capturedAt: activeCapturedAt,
            addedAt,
            fileName: candidate.fileName,
            displayDimensions: candidate.displayDimensions!,
            timelineThumbnails: input.timelineThumbnails,
          });
          if (!alreadyMigrated) {
            incrementDateIndex(userId, collection, activeCapturedAt, 1);
          }
        },

        async getTimelineProjectionsV2(collection) {
          return [...projectionsOf(userId).values()].filter(
            (projection) => projection.collection === collection,
          );
        },

        async getDateIndexV2(collection, year) {
          return omitZeroCounts({ ...(dateIndexOf(userId).get(dateIndexSortKey({ collection, year })) ?? {}) });
        },

        async queryTimelinePageV2({ collection, limit, after, atOrBefore }) {
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

        async queryAdjacentProjectionV2({ collection, capturedAt, addedAt, photoId, direction }) {
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

        async listDateIndexYearsV2(collection) {
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
