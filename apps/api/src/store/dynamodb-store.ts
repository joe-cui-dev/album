import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  DynamoDBDocumentClient,
  TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  isSameCapturedAt,
  type CapturedAt,
  type Photo,
  type PhotoChronology,
  type PhotoFormat,
  type ProcessingState,
  type UploadBatch,
} from "@album/shared";
import {
  ConcurrentPhotoModificationError,
  ProcessingAttemptConflictError,
  StaleChronologyRevisionError,
} from "./errors.js";
import type {
  DateIndexPeriodCounts,
  PersonalAlbum,
  PersonalAlbumStore,
  PhotoCollection,
  ProcessingIssueRecord,
  TimelineProjection,
} from "./personal-album.js";
import {
  PROCESSING_ISSUES_SUMMARY_SORT_KEY,
  dateIndexPeriodSegment,
  dateIndexSortKey,
  dateIndexYear,
  processingIssueSortKey,
  timelineProjectionSortKey,
} from "./v2-keys.js";

const photoKey = (userId: string, photoId: string) => ({
  pk: `USER#${userId}`,
  sk: `PHOTO#${photoId}`,
});
const uploadBatchKey = (userId: string, uploadBatchId: string) => ({
  pk: `USER#${userId}`,
  sk: `UPLOAD_BATCH#${uploadBatchId}`,
});
const projectionKey = (
  userId: string,
  input: { collection: PhotoCollection; capturedAt: CapturedAt; addedAt: string; photoId: string },
) => ({ pk: `USER#${userId}`, sk: timelineProjectionSortKey(input) });
const dateIndexKey = (
  userId: string,
  input: { collection: PhotoCollection; year: number },
) => ({ pk: `USER#${userId}`, sk: dateIndexSortKey(input) });
const issueKey = (userId: string, photoId: string, addedAt: string) => ({
  pk: `USER#${userId}`,
  sk: processingIssueSortKey({ addedAt, photoId }),
});
const issueSummaryKey = (userId: string) => ({
  pk: `USER#${userId}`,
  sk: PROCESSING_ISSUES_SUMMARY_SORT_KEY,
});

/** Reads a Photo and guards that it has a v2 Timeline/Archive projection to move. */
const readV2ReadyPhoto = async (
  documentClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  photoId: string,
): Promise<{
  item: Record<string, unknown>;
  chronology: PhotoChronology;
  addedAt: string;
  currentArchived: boolean;
}> => {
  const result = await documentClient.send(
    new GetCommand({ TableName: tableName, Key: photoKey(userId, photoId) }),
  );
  const item = result.Item;
  if (
    !item ||
    item.processingState !== "ready" ||
    !item.chronology ||
    typeof item.uploadRequestedAt !== "string" ||
    !item.timelineThumbnails
  ) {
    throw new Error(`Photo ${photoId} has no v2 Timeline projection`);
  }
  return {
    item,
    chronology: item.chronology as PhotoChronology,
    addedAt: item.uploadRequestedAt,
    currentArchived: Boolean(item.archived),
  };
};

const isConditionalCheckFailed = (error: unknown): boolean =>
  error instanceof Error && error.name === "ConditionalCheckFailedException";

const isTransactionCanceled = (error: unknown): boolean =>
  error instanceof Error && error.name === "TransactionCanceledException";

/** ADD on a top-level counter attribute; negative deltas are conditioned so a counter never goes below zero. */
const dateIndexIncrementItem = (
  tableName: string,
  userId: string,
  collection: PhotoCollection,
  capturedAt: CapturedAt,
  delta: number,
): NonNullable<TransactWriteCommandInput["TransactItems"]>[number] => {
  const period = dateIndexPeriodSegment(capturedAt);
  return {
    Update: {
      TableName: tableName,
      Key: dateIndexKey(userId, { collection, year: dateIndexYear(capturedAt) }),
      UpdateExpression: "ADD #period :delta",
      ExpressionAttributeNames: { "#period": period },
      ExpressionAttributeValues: {
        ":delta": delta,
        ...(delta < 0 ? { ":absDelta": -delta } : {}),
      },
      ...(delta < 0 ? { ConditionExpression: "#period >= :absDelta" } : {}),
    },
  };
};

const issuesSummaryIncrementItem = (
  tableName: string,
  userId: string,
  delta: number,
): NonNullable<TransactWriteCommandInput["TransactItems"]>[number] => ({
  Update: {
    TableName: tableName,
    Key: issueSummaryKey(userId),
    UpdateExpression: "ADD openCount :delta",
    ExpressionAttributeValues: {
      ":delta": delta,
      ...(delta < 0 ? { ":absDelta": -delta } : {}),
    },
    ...(delta < 0 ? { ConditionExpression: "openCount >= :absDelta" } : {}),
  },
});

export const createDynamoDbPersonalAlbumStore = ({
  documentClient,
  tableName,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
}): PersonalAlbumStore => ({
  personalAlbumOf(userId): PersonalAlbum {
    return {
      async getPhoto(photoId) {
        const result = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, photoId) }),
        );
        return asPhoto(result.Item);
      },
      async getUploadBatch(uploadBatchId) {
        const result = await documentClient.send(
          new GetCommand({
            TableName: tableName,
            Key: uploadBatchKey(userId, uploadBatchId),
          }),
        );
        return asUploadBatch(result.Item);
      },
      async listTimelinePhotos(input) {
        const expressionValues: Record<string, string> = { ":pk": `USER#${userId}` };
        const rangeIsSpecified = input.fromCapturedAt && input.toCapturedAt;
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: rangeIsSpecified
              ? "pk = :pk AND sk BETWEEN :fromSk AND :toSk"
              : "pk = :pk AND begins_with(sk, :timeline)",
            ExpressionAttributeValues: rangeIsSpecified
              ? {
                  ...expressionValues,
                  ":fromSk": `TIMELINE#${input.fromCapturedAt}`,
                  ":toSk": `TIMELINE#${input.toCapturedAt}`,
                }
              : { ...expressionValues, ":timeline": "TIMELINE#" },
          }),
        );
        const keys = (result.Items ?? [])
          .map((item) => (typeof item.photoId === "string" ? item.photoId : undefined))
          .filter((photoId): photoId is string => photoId !== undefined);
        const photos = await batchGetPhotos({ documentClient, tableName, userId, photoIds: keys });
        return photos
          .filter(
            (photo) =>
              input.processingState === undefined ||
              photo.processingState === input.processingState,
          )
          .filter((photo) => input.archived === undefined || photo.archived === input.archived)
          .sort((left, right) =>
            (right.capturedAt ?? "").localeCompare(left.capturedAt ?? ""),
          );
      },
      async findReadyPhotoBySha256({ sha256, excludePhotoId }) {
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :photo)",
            FilterExpression:
              "sha256 = :sha256 AND processingState = :ready AND photoId <> :photoId",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":photo": "PHOTO#",
              ":sha256": sha256,
              ":ready": "ready",
              ":photoId": excludePhotoId,
            },
            Limit: 1,
          }),
        );
        const photoId = result.Items?.[0]?.photoId;
        return typeof photoId === "string" ? { photoId } : undefined;
      },
      async createPhoto(input) {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              ...photoKey(userId, input.photoId),
              ...input,
              userId,
              processingState: "uploadRequested",
              archived: false,
            },
          }),
        );
      },
      async createUploadBatch(input) {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...uploadBatchKey(userId, input.uploadBatchId), ...input, userId },
          }),
        );
      },
      async markProcessingStarted(photoId) {
        await updatePhoto(documentClient, tableName, userId, photoId, {
          UpdateExpression:
            "SET processingState = :state REMOVE failureCode, failureMessage",
          ExpressionAttributeValues: { ":state": "processing" },
        });
      },
      async markProcessingFailed({ photoId, failureCode, failureMessage }) {
        await updatePhoto(documentClient, tableName, userId, photoId, {
          UpdateExpression:
            "SET processingState = :state, failureCode = :code, failureMessage = :message",
          ExpressionAttributeValues: {
            ":state": "processingFailed",
            ":code": failureCode,
            ":message": failureMessage,
          },
        });
      },
      async markExactDuplicate({ photoId, sha256, duplicateOfPhotoId }) {
        await updatePhoto(documentClient, tableName, userId, photoId, {
          UpdateExpression:
            "SET processingState = :state, sha256 = :sha256, duplicateOfPhotoId = :duplicateOfPhotoId REMOVE failureCode, failureMessage",
          ExpressionAttributeValues: {
            ":state": "exactDuplicate",
            ":sha256": sha256,
            ":duplicateOfPhotoId": duplicateOfPhotoId,
          },
        });
      },
      async markReady(input) {
        await updatePhoto(documentClient, tableName, userId, input.photoId, {
          UpdateExpression:
            "SET processingState = :state, sha256 = :sha256, displayObjectKey = :displayObjectKey, displayDimensions = :displayDimensions, timelineThumbnailObjectKey = :timelineThumbnailObjectKey, timelineThumbnailDimensions = :timelineThumbnailDimensions, capturedAt = :capturedAt, capturedAtSource = :capturedAtSource, #metadata = :metadata REMOVE failureCode, failureMessage",
          ExpressionAttributeNames: { "#metadata": "metadata" },
          ExpressionAttributeValues: {
            ":state": "ready",
            ":sha256": input.sha256,
            ":displayObjectKey": input.displayObjectKey,
            ":displayDimensions": input.displayDimensions,
            ":timelineThumbnailObjectKey": input.timelineThumbnailObjectKey,
            ":timelineThumbnailDimensions": input.timelineThumbnailDimensions,
            ":capturedAt": input.capturedAt,
            ":capturedAtSource": input.capturedAtSource,
            ":metadata": input.metadata,
          },
        });
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: `USER#${userId}`,
              sk: `TIMELINE#${input.capturedAt}#${input.photoId}`,
              userId,
              photoId: input.photoId,
              capturedAt: input.capturedAt,
              fileName: input.fileName,
              processingState: "ready",
            },
          }),
        );
      },
      async archivePhoto(photoId) {
        await updatePhoto(documentClient, tableName, userId, photoId, {
          UpdateExpression: "SET archived = :archived",
          ExpressionAttributeValues: { ":archived": true },
        });
      },

      async publishReadyPhotoV2(input) {
        const photoResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, input.photoId) }),
        );
        const addedAt = photoResult.Item?.uploadRequestedAt;
        if (typeof addedAt !== "string") {
          throw new Error(`Photo ${input.photoId} has no uploadRequestedAt (Added At)`);
        }

        const chronology: PhotoChronology = {
          original: { capturedAt: input.originalCapturedAt, source: input.originalCapturedAtSource },
          active: {
            capturedAt: input.originalCapturedAt,
            source: input.originalCapturedAtSource,
            revision: 0,
          },
        };

        const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
          {
            Update: {
              TableName: tableName,
              Key: photoKey(userId, input.photoId),
              UpdateExpression:
                "SET processingState = :state, sha256 = :sha256, fileName = :fileName, displayObjectKey = :displayObjectKey, displayDimensions = :displayDimensions, timelineThumbnails = :timelineThumbnails, #metadata = :metadata, chronology = :chronology REMOVE failureCode, failureMessage, processingAttemptId, processingStartedAt",
              ExpressionAttributeNames: { "#metadata": "metadata" },
              ExpressionAttributeValues: {
                ":state": "ready",
                ":sha256": input.sha256,
                ":fileName": input.fileName,
                ":displayObjectKey": input.displayObjectKey,
                ":displayDimensions": input.displayDimensions,
                ":timelineThumbnails": input.timelineThumbnails,
                ":metadata": input.metadata,
                ":chronology": chronology,
                ...(input.attemptId !== undefined ? { ":attemptId": input.attemptId } : {}),
              },
              ...(input.attemptId !== undefined
                ? { ConditionExpression: "processingAttemptId = :attemptId" }
                : {}),
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                ...projectionKey(userId, {
                  collection: "active",
                  capturedAt: input.originalCapturedAt,
                  addedAt,
                  photoId: input.photoId,
                }),
                userId,
                photoId: input.photoId,
                collection: "active",
                capturedAt: input.originalCapturedAt,
                addedAt,
                fileName: input.fileName,
                displayDimensions: input.displayDimensions,
                timelineThumbnails: input.timelineThumbnails,
              },
            },
          },
          dateIndexIncrementItem(tableName, userId, "active", input.originalCapturedAt, 1),
        ];

        if (input.hadOpenProcessingIssue) {
          transactItems.push(
            { Delete: { TableName: tableName, Key: issueKey(userId, input.photoId, addedAt) } },
            issuesSummaryIncrementItem(tableName, userId, -1),
          );
        }

        await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
      },

      async publishExactDuplicateV2(input) {
        const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
          {
            Update: {
              TableName: tableName,
              Key: photoKey(userId, input.photoId),
              UpdateExpression:
                "SET processingState = :state, sha256 = :sha256, duplicateOfPhotoId = :duplicateOfPhotoId REMOVE failureCode, failureMessage, processingAttemptId, processingStartedAt",
              ExpressionAttributeValues: {
                ":state": "exactDuplicate",
                ":sha256": input.sha256,
                ":duplicateOfPhotoId": input.duplicateOfPhotoId,
                ...(input.attemptId !== undefined ? { ":attemptId": input.attemptId } : {}),
              },
              ...(input.attemptId !== undefined
                ? { ConditionExpression: "processingAttemptId = :attemptId" }
                : {}),
            },
          },
        ];

        if (input.hadOpenProcessingIssue) {
          const photoResult = await documentClient.send(
            new GetCommand({ TableName: tableName, Key: photoKey(userId, input.photoId) }),
          );
          const addedAt = photoResult.Item?.uploadRequestedAt;
          if (typeof addedAt !== "string") {
            throw new Error(`Photo ${input.photoId} has no uploadRequestedAt (Added At)`);
          }
          transactItems.push(
            { Delete: { TableName: tableName, Key: issueKey(userId, input.photoId, addedAt) } },
            issuesSummaryIncrementItem(tableName, userId, -1),
          );
        }

        await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
      },

      async setArchiveMembershipV2({ photoId, archived }) {
        const { item, chronology, addedAt, currentArchived } = await readV2ReadyPhoto(
          documentClient,
          tableName,
          userId,
          photoId,
        );
        if (currentArchived === archived) {
          return;
        }

        const fromCollection: PhotoCollection = currentArchived ? "archived" : "active";
        const toCollection: PhotoCollection = archived ? "archived" : "active";
        const capturedAt = chronology.active.capturedAt;
        const currentRevision = chronology.active.revision;

        try {
          await documentClient.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: tableName,
                    Key: photoKey(userId, photoId),
                    UpdateExpression: "SET archived = :archived",
                    ConditionExpression:
                      "archived = :currentArchived AND chronology.active.revision = :currentRevision",
                    ExpressionAttributeValues: {
                      ":archived": archived,
                      ":currentArchived": currentArchived,
                      ":currentRevision": currentRevision,
                    },
                  },
                },
                {
                  Delete: {
                    TableName: tableName,
                    Key: projectionKey(userId, { collection: fromCollection, capturedAt, addedAt, photoId }),
                  },
                },
                {
                  Put: {
                    TableName: tableName,
                    Item: {
                      ...projectionKey(userId, { collection: toCollection, capturedAt, addedAt, photoId }),
                      userId,
                      photoId,
                      collection: toCollection,
                      capturedAt,
                      addedAt,
                      fileName: item.fileName,
                      displayDimensions: item.displayDimensions,
                      timelineThumbnails: item.timelineThumbnails,
                    },
                  },
                },
                dateIndexIncrementItem(tableName, userId, fromCollection, capturedAt, -1),
                dateIndexIncrementItem(tableName, userId, toCollection, capturedAt, 1),
              ],
            }),
          );
        } catch (error) {
          if (isTransactionCanceled(error)) {
            throw new ConcurrentPhotoModificationError(photoId);
          }
          throw error;
        }
      },

      async replaceActiveChronologyV2({ photoId, capturedAt, expectedRevision }) {
        const { item, chronology, addedAt, currentArchived } = await readV2ReadyPhoto(
          documentClient,
          tableName,
          userId,
          photoId,
        );
        if (chronology.active.revision !== expectedRevision) {
          throw new StaleChronologyRevisionError(photoId);
        }
        if (
          chronology.active.source === "userAdjusted" &&
          isSameCapturedAt(chronology.active.capturedAt, capturedAt)
        ) {
          return { revision: chronology.active.revision };
        }

        const collection: PhotoCollection = currentArchived ? "archived" : "active";
        const nextRevision = chronology.active.revision + 1;

        try {
          await documentClient.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: tableName,
                    Key: photoKey(userId, photoId),
                    UpdateExpression: "SET chronology.active = :active",
                    ConditionExpression:
                      "chronology.active.revision = :expectedRevision AND archived = :currentArchived",
                    ExpressionAttributeValues: {
                      ":active": { capturedAt, source: "userAdjusted", revision: nextRevision },
                      ":expectedRevision": expectedRevision,
                      ":currentArchived": currentArchived,
                    },
                  },
                },
                {
                  Delete: {
                    TableName: tableName,
                    Key: projectionKey(userId, {
                      collection,
                      capturedAt: chronology.active.capturedAt,
                      addedAt,
                      photoId,
                    }),
                  },
                },
                {
                  Put: {
                    TableName: tableName,
                    Item: {
                      ...projectionKey(userId, { collection, capturedAt, addedAt, photoId }),
                      userId,
                      photoId,
                      collection,
                      capturedAt,
                      addedAt,
                      fileName: item.fileName,
                      displayDimensions: item.displayDimensions,
                      timelineThumbnails: item.timelineThumbnails,
                    },
                  },
                },
                dateIndexIncrementItem(tableName, userId, collection, chronology.active.capturedAt, -1),
                dateIndexIncrementItem(tableName, userId, collection, capturedAt, 1),
              ],
            }),
          );
        } catch (error) {
          if (isTransactionCanceled(error)) {
            throw new ConcurrentPhotoModificationError(photoId);
          }
          throw error;
        }

        return { revision: nextRevision };
      },

      async revertActiveChronologyV2({ photoId, expectedRevision }) {
        const { item, chronology, addedAt, currentArchived } = await readV2ReadyPhoto(
          documentClient,
          tableName,
          userId,
          photoId,
        );
        if (chronology.active.revision !== expectedRevision) {
          throw new StaleChronologyRevisionError(photoId);
        }
        const original = chronology.original;
        if (
          chronology.active.source === original.source &&
          isSameCapturedAt(chronology.active.capturedAt, original.capturedAt)
        ) {
          return { revision: chronology.active.revision };
        }

        const collection: PhotoCollection = currentArchived ? "archived" : "active";
        const nextRevision = chronology.active.revision + 1;

        try {
          await documentClient.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: tableName,
                    Key: photoKey(userId, photoId),
                    UpdateExpression: "SET chronology.active = :active",
                    ConditionExpression:
                      "chronology.active.revision = :expectedRevision AND archived = :currentArchived",
                    ExpressionAttributeValues: {
                      ":active": {
                        capturedAt: original.capturedAt,
                        source: original.source,
                        revision: nextRevision,
                      },
                      ":expectedRevision": expectedRevision,
                      ":currentArchived": currentArchived,
                    },
                  },
                },
                {
                  Delete: {
                    TableName: tableName,
                    Key: projectionKey(userId, {
                      collection,
                      capturedAt: chronology.active.capturedAt,
                      addedAt,
                      photoId,
                    }),
                  },
                },
                {
                  Put: {
                    TableName: tableName,
                    Item: {
                      ...projectionKey(userId, { collection, capturedAt: original.capturedAt, addedAt, photoId }),
                      userId,
                      photoId,
                      collection,
                      capturedAt: original.capturedAt,
                      addedAt,
                      fileName: item.fileName,
                      displayDimensions: item.displayDimensions,
                      timelineThumbnails: item.timelineThumbnails,
                    },
                  },
                },
                dateIndexIncrementItem(tableName, userId, collection, chronology.active.capturedAt, -1),
                dateIndexIncrementItem(tableName, userId, collection, original.capturedAt, 1),
              ],
            }),
          );
        } catch (error) {
          if (isTransactionCanceled(error)) {
            throw new ConcurrentPhotoModificationError(photoId);
          }
          throw error;
        }

        return { revision: nextRevision };
      },

      async recordProcessingIssueV2({ photoId, fileName, reasonCode, attemptedAt, attemptId }) {
        const photoResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, photoId) }),
        );
        const addedAt = photoResult.Item?.uploadRequestedAt;
        if (typeof addedAt !== "string") {
          throw new Error(`Photo ${photoId} has no uploadRequestedAt (Added At)`);
        }
        const issueResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: issueKey(userId, photoId, addedAt) }),
        );
        const existing = issueResult.Item as ProcessingIssueRecord | undefined;

        const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
          {
            Update: {
              TableName: tableName,
              Key: photoKey(userId, photoId),
              UpdateExpression:
                "SET processingState = :state, failureCode = :code REMOVE processingAttemptId, processingStartedAt",
              ExpressionAttributeValues: {
                ":state": "processingFailed",
                ":code": reasonCode,
                ...(attemptId !== undefined ? { ":attemptId": attemptId } : {}),
              },
              ...(attemptId !== undefined
                ? { ConditionExpression: "processingAttemptId = :attemptId" }
                : {}),
            },
          },
        ];

        if (existing) {
          transactItems.push({
            Update: {
              TableName: tableName,
              Key: issueKey(userId, photoId, addedAt),
              UpdateExpression:
                "SET #status = :status, attemptCount = attemptCount + :one, lastAttemptAt = :lastAttemptAt, reasonCode = :reasonCode",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":status": "failed",
                ":one": 1,
                ":lastAttemptAt": attemptedAt,
                ":reasonCode": reasonCode,
              },
            },
          });
        } else {
          transactItems.push(
            {
              Put: {
                TableName: tableName,
                Item: {
                  ...issueKey(userId, photoId, addedAt),
                  userId,
                  photoId,
                  fileName,
                  reasonCode,
                  status: "failed",
                  firstOpenedAt: attemptedAt,
                  attemptCount: 1,
                  lastAttemptAt: attemptedAt,
                },
              },
            },
            issuesSummaryIncrementItem(tableName, userId, 1),
          );
        }

        await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
      },

      async getProcessingIssue(photoId) {
        const photoResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, photoId) }),
        );
        const addedAt = photoResult.Item?.uploadRequestedAt;
        if (typeof addedAt !== "string") {
          return undefined;
        }
        const issueResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: issueKey(userId, photoId, addedAt) }),
        );
        return issueResult.Item as ProcessingIssueRecord | undefined;
      },

      async claimProcessingAttempt({ photoId, attemptId, startedAt }) {
        try {
          await documentClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: photoKey(userId, photoId),
              UpdateExpression:
                "SET processingState = :processing, processingAttemptId = :attemptId, processingStartedAt = :startedAt",
              ConditionExpression: "attribute_not_exists(processingAttemptId)",
              ExpressionAttributeValues: {
                ":processing": "processing",
                ":attemptId": attemptId,
                ":startedAt": startedAt,
              },
            }),
          );
          return "claimed";
        } catch (error) {
          if (!isConditionalCheckFailed(error)) {
            throw error;
          }
        }

        try {
          await documentClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: photoKey(userId, photoId),
              UpdateExpression: "SET processingState = :processing",
              ConditionExpression: "processingAttemptId = :attemptId",
              ExpressionAttributeValues: { ":processing": "processing", ":attemptId": attemptId },
            }),
          );
          return "resumed";
        } catch (error) {
          if (isConditionalCheckFailed(error)) {
            throw new ProcessingAttemptConflictError(photoId);
          }
          throw error;
        }
      },

      async applyMigrationVersionV2(input) {
        const photoResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, input.photoId) }),
        );
        const item = photoResult.Item;
        if (!item || item.processingState !== "ready") {
          throw new Error(`Photo ${input.photoId} is not Ready; cannot migrate`);
        }
        const currentMigrationVersion =
          typeof item.migrationVersion === "number" ? item.migrationVersion : 0;
        if (currentMigrationVersion >= input.migrationVersion) {
          return;
        }
        const addedAt = item.uploadRequestedAt;
        if (typeof addedAt !== "string") {
          throw new Error(`Photo ${input.photoId} has no uploadRequestedAt (Added At)`);
        }

        const alreadyMigrated = item.chronology !== undefined;
        const chronology: PhotoChronology = alreadyMigrated
          ? (item.chronology as PhotoChronology)
          : {
              original: { capturedAt: input.originalCapturedAt, source: input.originalCapturedAtSource },
              active: {
                capturedAt: input.originalCapturedAt,
                source: input.originalCapturedAtSource,
                revision: 0,
              },
            };
        const currentArchived = Boolean(item.archived);
        const collection: PhotoCollection = currentArchived ? "archived" : "active";
        const activeCapturedAt = chronology.active.capturedAt;

        const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
          {
            Update: {
              TableName: tableName,
              Key: photoKey(userId, input.photoId),
              UpdateExpression:
                "SET timelineThumbnails = :timelineThumbnails, migrationVersion = :migrationVersion" +
                (alreadyMigrated ? "" : ", chronology = :chronology"),
              ConditionExpression:
                "(attribute_not_exists(migrationVersion) OR migrationVersion < :migrationVersion) AND archived = :currentArchived" +
                (alreadyMigrated ? " AND chronology.active.revision = :currentRevision" : ""),
              ExpressionAttributeValues: {
                ":timelineThumbnails": input.timelineThumbnails,
                ":migrationVersion": input.migrationVersion,
                ":currentArchived": currentArchived,
                ...(alreadyMigrated ? { ":currentRevision": chronology.active.revision } : {}),
                ...(alreadyMigrated ? {} : { ":chronology": chronology }),
              },
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                ...projectionKey(userId, { collection, capturedAt: activeCapturedAt, addedAt, photoId: input.photoId }),
                userId,
                photoId: input.photoId,
                collection,
                capturedAt: activeCapturedAt,
                addedAt,
                fileName: item.fileName,
                displayDimensions: item.displayDimensions,
                timelineThumbnails: input.timelineThumbnails,
              },
            },
          },
        ];
        if (!alreadyMigrated) {
          transactItems.push(
            dateIndexIncrementItem(tableName, userId, collection, activeCapturedAt, 1),
          );
        }

        try {
          await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
        } catch (error) {
          if (isTransactionCanceled(error)) {
            throw new ConcurrentPhotoModificationError(input.photoId);
          }
          throw error;
        }
      },

      async getTimelineProjectionsV2(collection) {
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":prefix": `TIMELINE_V2#${collection === "active" ? "ACTIVE" : "ARCHIVED"}#`,
            },
          }),
        );
        return (result.Items ?? []).map(
          (item) =>
            ({
              photoId: item.photoId,
              collection,
              capturedAt: item.capturedAt,
              addedAt: item.addedAt,
              fileName: item.fileName,
              displayDimensions: item.displayDimensions,
              timelineThumbnails: item.timelineThumbnails,
            }) as TimelineProjection,
        );
      },

      async getDateIndexV2(collection, year) {
        const result = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: dateIndexKey(userId, { collection, year }) }),
        );
        const { pk: _pk, sk: _sk, ...counts } = result.Item ?? {};
        return counts as DateIndexPeriodCounts;
      },
    };
  },
});

const updatePhoto = async (
  documentClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  photoId: string,
  input: Pick<UpdateCommand["input"], "UpdateExpression" | "ExpressionAttributeNames" | "ExpressionAttributeValues">,
) => {
  await documentClient.send(
    new UpdateCommand({ TableName: tableName, Key: photoKey(userId, photoId), ...input }),
  );
};

const batchGetPhotos = async ({
  documentClient,
  tableName,
  userId,
  photoIds,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
  userId: string;
  photoIds: string[];
}): Promise<Photo[]> => {
  const photos: Photo[] = [];
  for (let index = 0; index < photoIds.length; index += 100) {
    let keys = photoIds.slice(index, index + 100).map((photoId) => photoKey(userId, photoId));
    while (keys.length > 0) {
      const result = await documentClient.send(
        new BatchGetCommand({ RequestItems: { [tableName]: { Keys: keys } } }),
      );
      photos.push(...(result.Responses?.[tableName] ?? []).map(asPhoto).filter((photo): photo is Photo => Boolean(photo)));
      keys = (result.UnprocessedKeys?.[tableName]?.Keys ?? []) as typeof keys;
    }
  }
  return photos;
};

export const asPhoto = (item: Record<string, unknown> | undefined): Photo | undefined => {
  if (!item) {
    return undefined;
  }
  if (
    typeof item.photoId !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.uploadBatchId !== "string" ||
    typeof item.originalObjectKey !== "string" ||
    typeof item.fileName !== "string" ||
    !isPhotoFormat(item.format) ||
    typeof item.fileSizeBytes !== "number" ||
    !isProcessingState(item.processingState) ||
    typeof item.archived !== "boolean"
  ) {
    console.error(JSON.stringify({ level: "error", message: "Invalid Photo item in PersonalAlbum store", item }));
    return undefined;
  }
  return item as unknown as Photo;
};

const asUploadBatch = (item: Record<string, unknown> | undefined): UploadBatch | undefined => {
  if (
    !item ||
    typeof item.uploadBatchId !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.createdAt !== "string" ||
    !Array.isArray(item.photoIds) ||
    !item.photoIds.every((photoId) => typeof photoId === "string")
  ) {
    return undefined;
  }
  return item as unknown as UploadBatch;
};

const isPhotoFormat = (value: unknown): value is PhotoFormat =>
  ["jpeg", "png", "heic"].includes(value as PhotoFormat);
const isProcessingState = (value: unknown): value is ProcessingState =>
  ["uploadRequested", "processing", "ready", "processingFailed", "exactDuplicate"].includes(value as ProcessingState);
