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
  MembershipCollection,
  PersonalAlbum,
  PersonalAlbumStore,
  PhotoCollection,
  ProcessingIssueRecord,
  TimelineProjection,
} from "./personal-album.js";
import {
  PROCESSING_ISSUES_SUMMARY_SORT_KEY,
  dateIndexPeriodSegment,
  dateIndexPrefix,
  dateIndexSortKey,
  dateIndexYear,
  omitZeroCounts,
  processingIssueSortKey,
  timelineProjectionPrefix,
  timelineProjectionSortKey,
} from "./projection-keys.js";

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
/** The `favourite` projection row's full Item body (ADR-0077 §2.2): the same shape a Timeline/Trash Put uses, always with `favourite: true`. */
const favouriteProjectionItem = (
  userId: string,
  input: { photoId: string; capturedAt: CapturedAt; addedAt: string; item: Record<string, unknown> },
) => ({
  ...projectionKey(userId, { collection: "favourite", capturedAt: input.capturedAt, addedAt: input.addedAt, photoId: input.photoId }),
  userId,
  photoId: input.photoId,
  collection: "favourite" as const,
  capturedAt: input.capturedAt,
  addedAt: input.addedAt,
  fileName: input.item.fileName,
  displayDimensions: input.item.displayDimensions,
  timelineThumbnails: input.item.timelineThumbnails,
  favourite: true,
});

const issueKey = (userId: string, photoId: string, addedAt: string) => ({
  pk: `USER#${userId}`,
  sk: processingIssueSortKey({ addedAt, photoId }),
});
const issueSummaryKey = (userId: string) => ({
  pk: `USER#${userId}`,
  sk: PROCESSING_ISSUES_SUMMARY_SORT_KEY,
});
const EXPIRED_TRASH_INDEX_NAME = "ExpiredTrashIndex";
const expiredTrashAttributes = (userId: string, photoId: string, deletedAt: string) => ({
  sweepKey: "TRASH",
  sweepSortKey: `${deletedAt}#${userId}#${photoId}`,
});
const encodeSweepCursor = (key: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
const decodeSweepCursor = (cursor: string): Record<string, unknown> | undefined => {
  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return typeof key === "object" && key !== null ? key as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
};

/** Reads a Photo and guards that it has a Timeline/Trash projection to move. */
const readReadyPhoto = async (
  documentClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  photoId: string,
): Promise<{
  item: Record<string, unknown>;
  chronology: PhotoChronology;
  addedAt: string;
  currentTrashed: boolean;
  currentFavourite: boolean;
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
    throw new Error(`Photo ${photoId} has no Timeline projection`);
  }
  return {
    item,
    chronology: item.chronology as PhotoChronology,
    addedAt: item.uploadRequestedAt,
    currentTrashed: Boolean(item.trashed),
    currentFavourite: Boolean(item.favourite),
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

interface DateIndexDelta {
  collection: PhotoCollection;
  capturedAt: CapturedAt;
  delta: number;
}

/**
 * Aggregates Date Index deltas by their exact (pk, sk) item key -- collection
 * and year -- before building transact items, netting each period's delta
 * within a key and omitting a net-zero delta entirely. DynamoDB rejects a
 * TransactWriteItems list that touches one item twice, which an old/new pair
 * landing in the same year (e.g. Adjust Captured At refining 2024-06 to
 * 2024-06-15) would otherwise do by emitting two separate `Update`s against
 * the identical key.
 */
const buildDateIndexUpdateItems = (
  tableName: string,
  userId: string,
  deltas: DateIndexDelta[],
): NonNullable<TransactWriteCommandInput["TransactItems"]> => {
  const groups = new Map<string, { collection: PhotoCollection; year: number; periods: Map<string, number> }>();
  for (const { collection, capturedAt, delta } of deltas) {
    const year = dateIndexYear(capturedAt);
    const period = dateIndexPeriodSegment(capturedAt);
    const key = `${collection}#${year}`;
    let group = groups.get(key);
    if (!group) {
      group = { collection, year, periods: new Map() };
      groups.set(key, group);
    }
    group.periods.set(period, (group.periods.get(period) ?? 0) + delta);
  }

  const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  for (const group of groups.values()) {
    const netPeriods = [...group.periods.entries()].filter(([, net]) => net !== 0);
    if (netPeriods.length === 0) {
      continue;
    }
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, number> = {};
    const addClauses: string[] = [];
    const conditionClauses: string[] = [];
    netPeriods.forEach(([period, net], index) => {
      const nameKey = `#period${index}`;
      const deltaKey = `:delta${index}`;
      expressionNames[nameKey] = period;
      expressionValues[deltaKey] = net;
      addClauses.push(`${nameKey} ${deltaKey}`);
      if (net < 0) {
        const absKey = `:absDelta${index}`;
        expressionValues[absKey] = -net;
        conditionClauses.push(`${nameKey} >= ${absKey}`);
      }
    });
    items.push({
      Update: {
        TableName: tableName,
        Key: dateIndexKey(userId, { collection: group.collection, year: group.year }),
        UpdateExpression: `ADD ${addClauses.join(", ")}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ...(conditionClauses.length > 0 ? { ConditionExpression: conditionClauses.join(" AND ") } : {}),
      },
    });
  }
  return items;
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
  async queryExpiredTrashedPhotos({ before, limit, cursor }) {
    const exclusiveStartKey = cursor === undefined ? undefined : decodeSweepCursor(cursor);
    if (cursor !== undefined && !exclusiveStartKey) {
      throw new Error("Invalid expired Trash cursor");
    }
    const result = await documentClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: EXPIRED_TRASH_INDEX_NAME,
        KeyConditionExpression: "sweepKey = :sweepKey AND sweepSortKey <= :before",
        ExpressionAttributeValues: { ":sweepKey": "TRASH", ":before": `${before}#\uffff` },
        Limit: limit,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    return {
      photos: (result.Items ?? [])
        .filter((item) => typeof item.userId === "string" && typeof item.photoId === "string")
        .map((item) => ({ userId: item.userId as string, photoId: item.photoId as string })),
      ...(result.LastEvaluatedKey ? { nextCursor: encodeSweepCursor(result.LastEvaluatedKey) } : {}),
    };
  },
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
      async findReadyPhotoBySha256({ sha256, excludePhotoId }) {
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :photo)",
            FilterExpression:
              "sha256 = :sha256 AND processingState = :ready AND trashed = :notTrashed AND photoId <> :photoId",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":photo": "PHOTO#",
              ":sha256": sha256,
              ":ready": "ready",
              ":notTrashed": false,
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
              trashed: false,
              favourite: false,
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
          UpdateExpression: "SET processingState = :state REMOVE failureCode",
          ConditionExpression: "attribute_not_exists(permanentDeletionReservationId)",
          ExpressionAttributeValues: { ":state": "processing" },
        });
      },
      async publishReadyPhoto(input) {
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
                "SET processingState = :state, sha256 = :sha256, fileName = :fileName, displayObjectKey = :displayObjectKey, displayDimensions = :displayDimensions, timelineThumbnails = :timelineThumbnails, #metadata = :metadata, chronology = :chronology REMOVE failureCode, processingAttemptId, processingStartedAt",
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
              ConditionExpression: input.attemptId !== undefined
                ? "processingAttemptId = :attemptId AND attribute_not_exists(permanentDeletionReservationId)"
                : "attribute_not_exists(permanentDeletionReservationId)",
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
                favourite: false,
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

      async publishExactDuplicate(input) {
        const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
          {
            Update: {
              TableName: tableName,
              Key: photoKey(userId, input.photoId),
              UpdateExpression:
                "SET processingState = :state, sha256 = :sha256, duplicateOfPhotoId = :duplicateOfPhotoId REMOVE failureCode, processingAttemptId, processingStartedAt",
              ExpressionAttributeValues: {
                ":state": "exactDuplicate",
                ":sha256": input.sha256,
                ":duplicateOfPhotoId": input.duplicateOfPhotoId,
                ...(input.attemptId !== undefined ? { ":attemptId": input.attemptId } : {}),
              },
              ConditionExpression: input.attemptId !== undefined
                ? "processingAttemptId = :attemptId AND attribute_not_exists(permanentDeletionReservationId)"
                : "attribute_not_exists(permanentDeletionReservationId)",
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

      async setTrashMembership({ photoId, trashed }) {
        const { item, chronology, addedAt, currentTrashed, currentFavourite } = await readReadyPhoto(
          documentClient,
          tableName,
          userId,
          photoId,
        );
        if (currentTrashed === trashed) {
          return;
        }

        const fromCollection: MembershipCollection = currentTrashed ? "trashed" : "active";
        const toCollection: MembershipCollection = trashed ? "trashed" : "active";
        const deletedAt = trashed ? new Date().toISOString() : undefined;
        const capturedAt = chronology.active.capturedAt;
        const currentRevision = chronology.active.revision;

        // ADR-0077 invariant: a `favourite` row exists iff the Photo is favourited AND not
        // trashed. Trashing a Favourite Photo removes its row; restoring one recreates it. The
        // `favourite` attribute itself (SET above) is untouched either way.
        const favouriteRowItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = currentFavourite
          ? trashed
            ? [
                {
                  Delete: {
                    TableName: tableName,
                    Key: projectionKey(userId, { collection: "favourite", capturedAt, addedAt, photoId }),
                  },
                },
                dateIndexIncrementItem(tableName, userId, "favourite", capturedAt, -1),
              ]
            : [
                {
                  Put: {
                    TableName: tableName,
                    Item: favouriteProjectionItem(userId, { photoId, capturedAt, addedAt, item }),
                  },
                },
                dateIndexIncrementItem(tableName, userId, "favourite", capturedAt, 1),
              ]
          : [];

        try {
          await documentClient.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: tableName,
                    Key: photoKey(userId, photoId),
                    UpdateExpression: trashed ? "SET trashed = :trashed, deletedAt = :deletedAt" : "SET trashed = :trashed REMOVE deletedAt",
                    ConditionExpression:
                      "trashed = :currentTrashed AND chronology.active.revision = :currentRevision AND attribute_not_exists(permanentDeletionReservationId)",
                    ExpressionAttributeValues: {
                      ":trashed": trashed,
                      ":currentTrashed": currentTrashed,
                      ":currentRevision": currentRevision,
                      ...(deletedAt ? { ":deletedAt": deletedAt } : {}),
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
                      favourite: currentFavourite,
                      ...(deletedAt ? { deletedAt, ...expiredTrashAttributes(userId, photoId, deletedAt) } : {}),
                    },
                  },
                },
                dateIndexIncrementItem(tableName, userId, fromCollection, capturedAt, -1),
                dateIndexIncrementItem(tableName, userId, toCollection, capturedAt, 1),
                ...favouriteRowItems,
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

      async setFavourite({ photoId, favourite }) {
        const { item, chronology, addedAt, currentTrashed, currentFavourite } = await readReadyPhoto(
          documentClient,
          tableName,
          userId,
          photoId,
        );
        if (currentFavourite === favourite) {
          return;
        }

        const collection: MembershipCollection = currentTrashed ? "trashed" : "active";
        const capturedAt = chronology.active.capturedAt;
        const currentRevision = chronology.active.revision;

        // ADR-0077 invariant: the `favourite` row only exists while the Photo is not trashed, so
        // toggling the mark on a trashed Photo flips just the attribute and its Trash projection
        // row's copy -- there is no `favourite` row to add or remove.
        const favouriteRowItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = currentTrashed
          ? []
          : favourite
            ? [
                {
                  Put: {
                    TableName: tableName,
                    Item: favouriteProjectionItem(userId, { photoId, capturedAt, addedAt, item }),
                  },
                },
                dateIndexIncrementItem(tableName, userId, "favourite", capturedAt, 1),
              ]
            : [
                {
                  Delete: {
                    TableName: tableName,
                    Key: projectionKey(userId, { collection: "favourite", capturedAt, addedAt, photoId }),
                  },
                },
                dateIndexIncrementItem(tableName, userId, "favourite", capturedAt, -1),
              ];

        try {
          await documentClient.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: tableName,
                    Key: photoKey(userId, photoId),
                    UpdateExpression: "SET favourite = :favourite",
                    ConditionExpression:
                      "favourite = :currentFavourite AND trashed = :currentTrashed AND chronology.active.revision = :currentRevision AND attribute_not_exists(permanentDeletionReservationId)",
                    ExpressionAttributeValues: {
                      ":favourite": favourite,
                      ":currentFavourite": currentFavourite,
                      ":currentTrashed": currentTrashed,
                      ":currentRevision": currentRevision,
                    },
                  },
                },
                {
                  Update: {
                    TableName: tableName,
                    Key: projectionKey(userId, { collection, capturedAt, addedAt, photoId }),
                    UpdateExpression: "SET favourite = :favourite",
                    ExpressionAttributeValues: { ":favourite": favourite },
                  },
                },
                ...favouriteRowItems,
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

      async reservePermanentDeletion({ photo, reservationId }) {
        const expected = photo.processingState === "ready"
          ? {
              condition:
                "processingState = :state AND trashed = :trashed AND deletedAt = :deletedAt AND chronology.active.revision = :revision",
              values: { ":state": "ready", ":trashed": true, ":deletedAt": photo.deletedAt, ":revision": photo.chronology?.active.revision },
            }
          : {
              condition: "processingState = :state",
              values: { ":state": "processingFailed" },
            };
        try {
          await documentClient.send(new UpdateCommand({
            TableName: tableName,
            Key: photoKey(userId, photo.photoId),
            UpdateExpression: "SET permanentDeletionReservationId = :reservationId",
            ConditionExpression: expected.condition,
            ExpressionAttributeValues: { ...expected.values, ":reservationId": reservationId },
          }));
          return true;
        } catch (error) {
          if (!isConditionalCheckFailed(error)) throw error;
          const latest = await documentClient.send(
            new GetCommand({ TableName: tableName, Key: photoKey(userId, photo.photoId) }),
          );
          if (!latest.Item) return false;
          throw new ConcurrentPhotoModificationError(photo.photoId);
        }
      },

      async permanentlyDeletePhoto({ photo, reservationId }) {
        const current = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, photo.photoId) }),
        );
        if (!current.Item) return;

        const transactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
        if (photo.processingState === "ready") {
          const chronology = photo.chronology;
          const addedAt = photo.uploadRequestedAt;
          if (!chronology || !addedAt) throw new Error(`Photo ${photo.photoId} has no Timeline projection`);
          transactItems.push(
            {
              Delete: {
                TableName: tableName,
                Key: photoKey(userId, photo.photoId),
                ConditionExpression:
                  "processingState = :state AND trashed = :trashed AND deletedAt = :deletedAt AND chronology.active.revision = :revision AND permanentDeletionReservationId = :reservationId",
                ExpressionAttributeValues: {
                  ":state": "ready",
                  ":trashed": true,
                  ":deletedAt": photo.deletedAt,
                  ":revision": chronology.active.revision,
                  ":reservationId": reservationId,
                },
              },
            },
            {
              Delete: {
                TableName: tableName,
                Key: projectionKey(userId, {
                  collection: "trashed",
                  capturedAt: chronology.active.capturedAt,
                  addedAt,
                  photoId: photo.photoId,
                }),
              },
            },
            dateIndexIncrementItem(tableName, userId, "trashed", chronology.active.capturedAt, -1),
          );
        } else if (photo.processingState === "processingFailed") {
          const addedAt = photo.uploadRequestedAt;
          const issue = typeof addedAt === "string"
            ? await documentClient.send(new GetCommand({ TableName: tableName, Key: issueKey(userId, photo.photoId, addedAt) }))
            : undefined;
          transactItems.push({
            Delete: {
              TableName: tableName,
              Key: photoKey(userId, photo.photoId),
              ConditionExpression: "processingState = :state AND permanentDeletionReservationId = :reservationId",
              ExpressionAttributeValues: { ":state": "processingFailed", ":reservationId": reservationId },
            },
          });
          if (issue?.Item && typeof addedAt === "string") {
            transactItems.push(
              { Delete: { TableName: tableName, Key: issueKey(userId, photo.photoId, addedAt) } },
              issuesSummaryIncrementItem(tableName, userId, -1),
            );
          }
        } else {
          throw new Error(`Photo ${photo.photoId} is not eligible for Permanent Deletion`);
        }

        try {
          await documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
        } catch (error) {
          if (!isTransactionCanceled(error)) throw error;
          const latest = await documentClient.send(
            new GetCommand({ TableName: tableName, Key: photoKey(userId, photo.photoId) }),
          );
          if (!latest.Item) return;
          throw new ConcurrentPhotoModificationError(photo.photoId);
        }
      },

      async replaceActiveChronology({ photoId, capturedAt, expectedRevision }) {
        const { item, chronology, addedAt, currentTrashed, currentFavourite } = await readReadyPhoto(
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

        const collection: MembershipCollection = currentTrashed ? "trashed" : "active";
        const nextRevision = chronology.active.revision + 1;
        // ADR-0077 invariant: a non-trashed Favourite Photo also has its `favourite` row moved
        // to the new Captured At, in the same transaction as the membership-collection move.
        const isFavouriteRowMoved = !currentTrashed && currentFavourite;

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
                      "chronology.active.revision = :expectedRevision AND trashed = :currentTrashed AND attribute_not_exists(permanentDeletionReservationId)",
                    ExpressionAttributeValues: {
                      ":active": { capturedAt, source: "userAdjusted", revision: nextRevision },
                      ":expectedRevision": expectedRevision,
                      ":currentTrashed": currentTrashed,
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
                      favourite: currentFavourite,
                      ...(currentTrashed && typeof item.deletedAt === "string"
                        ? { deletedAt: item.deletedAt, ...expiredTrashAttributes(userId, photoId, item.deletedAt) }
                        : {}),
                    },
                  },
                },
                ...(isFavouriteRowMoved
                  ? [
                      {
                        Delete: {
                          TableName: tableName,
                          Key: projectionKey(userId, {
                            collection: "favourite" as const,
                            capturedAt: chronology.active.capturedAt,
                            addedAt,
                            photoId,
                          }),
                        },
                      },
                      {
                        Put: {
                          TableName: tableName,
                          Item: favouriteProjectionItem(userId, { photoId, capturedAt, addedAt, item }),
                        },
                      },
                    ]
                  : []),
                ...buildDateIndexUpdateItems(tableName, userId, [
                  { collection, capturedAt: chronology.active.capturedAt, delta: -1 },
                  { collection, capturedAt, delta: 1 },
                  ...(isFavouriteRowMoved
                    ? [
                        { collection: "favourite" as const, capturedAt: chronology.active.capturedAt, delta: -1 },
                        { collection: "favourite" as const, capturedAt, delta: 1 },
                      ]
                    : []),
                ]),
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

      async revertActiveChronology({ photoId, expectedRevision }) {
        const { item, chronology, addedAt, currentTrashed, currentFavourite } = await readReadyPhoto(
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

        const collection: MembershipCollection = currentTrashed ? "trashed" : "active";
        const nextRevision = chronology.active.revision + 1;
        // ADR-0077 invariant: a non-trashed Favourite Photo also has its `favourite` row moved
        // back to the original Captured At, in the same transaction as the membership move.
        const isFavouriteRowMoved = !currentTrashed && currentFavourite;

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
                      "chronology.active.revision = :expectedRevision AND trashed = :currentTrashed AND attribute_not_exists(permanentDeletionReservationId)",
                    ExpressionAttributeValues: {
                      ":active": {
                        capturedAt: original.capturedAt,
                        source: original.source,
                        revision: nextRevision,
                      },
                      ":expectedRevision": expectedRevision,
                      ":currentTrashed": currentTrashed,
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
                      favourite: currentFavourite,
                      ...(currentTrashed && typeof item.deletedAt === "string"
                        ? { deletedAt: item.deletedAt, ...expiredTrashAttributes(userId, photoId, item.deletedAt) }
                        : {}),
                    },
                  },
                },
                ...(isFavouriteRowMoved
                  ? [
                      {
                        Delete: {
                          TableName: tableName,
                          Key: projectionKey(userId, {
                            collection: "favourite" as const,
                            capturedAt: chronology.active.capturedAt,
                            addedAt,
                            photoId,
                          }),
                        },
                      },
                      {
                        Put: {
                          TableName: tableName,
                          Item: favouriteProjectionItem(userId, { photoId, capturedAt: original.capturedAt, addedAt, item }),
                        },
                      },
                    ]
                  : []),
                ...buildDateIndexUpdateItems(tableName, userId, [
                  { collection, capturedAt: chronology.active.capturedAt, delta: -1 },
                  { collection, capturedAt: original.capturedAt, delta: 1 },
                  ...(isFavouriteRowMoved
                    ? [
                        { collection: "favourite" as const, capturedAt: chronology.active.capturedAt, delta: -1 },
                        { collection: "favourite" as const, capturedAt: original.capturedAt, delta: 1 },
                      ]
                    : []),
                ]),
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

      async recordProcessingIssue({ photoId, fileName, reasonCode, attemptedAt, attemptId }) {
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
              ConditionExpression: attemptId !== undefined
                ? "processingAttemptId = :attemptId AND attribute_not_exists(permanentDeletionReservationId)"
                : "attribute_not_exists(permanentDeletionReservationId)",
            },
          },
        ];

        if (existing) {
          transactItems.push({
            Update: {
              TableName: tableName,
              Key: issueKey(userId, photoId, addedAt),
              UpdateExpression:
                "SET #status = :status, attemptCount = attemptCount + :one, lastAttemptAt = :lastAttemptAt, reasonCode = :reasonCode REMOVE retryAttemptId",
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
        return issueResult.Item
          ? ({ ...issueResult.Item, addedAt } as ProcessingIssueRecord)
          : undefined;
      },

      async beginProcessingIssueRetry({ photoId, retryAttemptId, attemptedAt }) {
        const photoResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, photoId) }),
        );
        const addedAt = photoResult.Item?.uploadRequestedAt;
        if (typeof addedAt !== "string" || photoResult.Item?.processingState !== "processingFailed") {
          throw new Error(`Photo ${photoId} has no open Processing Issue`);
        }
        const current = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: issueKey(userId, photoId, addedAt) }),
        );
        if (!current.Item) {
          throw new Error(`Photo ${photoId} has no open Processing Issue`);
        }
        if (typeof current.Item.retryAttemptId === "string" && current.Item.retryAttemptId !== retryAttemptId) {
          return { retryAttemptId: current.Item.retryAttemptId };
        }
        try {
          await documentClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: issueKey(userId, photoId, addedAt),
              UpdateExpression: "SET #status = :retrying, retryAttemptId = :retryAttemptId, lastAttemptAt = :attemptedAt REMOVE retryReservationExpiresAt",
              ConditionExpression: "#status = :failed AND retryAttemptId = :retryAttemptId",
              ExpressionAttributeNames: { "#status": "status" },
              ExpressionAttributeValues: {
                ":retrying": "retrying",
                ":failed": "failed",
                ":retryAttemptId": retryAttemptId,
                ":attemptedAt": attemptedAt,
              },
            }),
          );
          return { retryAttemptId };
        } catch (error) {
          if (!isConditionalCheckFailed(error)) throw error;
          const latest = await documentClient.send(
            new GetCommand({ TableName: tableName, Key: issueKey(userId, photoId, addedAt) }),
          );
          if (typeof latest.Item?.retryAttemptId === "string") {
            return { retryAttemptId: latest.Item.retryAttemptId };
          }
          throw error;
        }
      },

      async reserveProcessingIssueRetry({ photoId, retryAttemptId, reservedAt, reservationExpiresAt }) {
        const issue = await this.getProcessingIssue(photoId);
        if (!issue) throw new Error(`Photo ${photoId} has no open Processing Issue`);
        if (
          issue.retryAttemptId &&
          (issue.status === "retrying" ||
            (issue.retryReservationExpiresAt !== undefined && issue.retryReservationExpiresAt >= reservedAt))
        ) return { retryAttemptId: issue.retryAttemptId };
        try {
          await documentClient.send(new UpdateCommand({
            TableName: tableName,
            Key: issueKey(userId, photoId, issue.addedAt),
            UpdateExpression: "SET retryAttemptId = :retryAttemptId, retryReservationExpiresAt = :reservationExpiresAt",
            ConditionExpression: "#status = :failed AND (attribute_not_exists(retryAttemptId) OR retryReservationExpiresAt < :reservedAt)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":failed": "failed", ":retryAttemptId": retryAttemptId, ":reservedAt": reservedAt, ":reservationExpiresAt": reservationExpiresAt },
          }));
          return { retryAttemptId };
        } catch (error) {
          if (!isConditionalCheckFailed(error)) throw error;
          const latest = await this.getProcessingIssue(photoId);
          if (latest?.retryAttemptId) return { retryAttemptId: latest.retryAttemptId };
          throw error;
        }
      },

      async releaseProcessingIssueRetry({ photoId, retryAttemptId }) {
        const issue = await this.getProcessingIssue(photoId);
        if (!issue) return;
        try {
          await documentClient.send(new UpdateCommand({
            TableName: tableName,
            Key: issueKey(userId, photoId, issue.addedAt),
            UpdateExpression: "REMOVE retryAttemptId, retryReservationExpiresAt",
            ConditionExpression: "#status = :failed AND retryAttemptId = :retryAttemptId",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":failed": "failed", ":retryAttemptId": retryAttemptId },
          }));
        } catch (error) {
          if (!isConditionalCheckFailed(error)) throw error;
        }
      },

      async queryProcessingIssues({ limit, after }) {
        const prefix = "PROCESSING_ISSUE#";
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":prefix": prefix },
            ScanIndexForward: false,
            ConsistentRead: true,
            Limit: limit,
            ...(after ? { ExclusiveStartKey: { pk: `USER#${userId}`, sk: after.sortKey } } : {}),
          }),
        );
        const items = result.Items ?? [];
        return {
          issues: items.map((item) => ({
            ...item,
            addedAt: String(item.sk).slice(prefix.length).split("#")[0],
          }) as ProcessingIssueRecord),
          ...(items.length === limit && items.length > 0
            ? { lastSortKey: String(items[items.length - 1]!.sk) }
            : {}),
        };
      },

      async claimProcessingAttempt({ photoId, attemptId, startedAt }) {
        const photoResult = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: photoKey(userId, photoId) }),
        );
        const addedAt = photoResult.Item?.uploadRequestedAt;
        if (typeof addedAt === "string") {
          const issueResult = await documentClient.send(
            new GetCommand({ TableName: tableName, Key: issueKey(userId, photoId, addedAt) }),
          );
          if (
            typeof issueResult.Item?.retryAttemptId === "string" &&
            typeof issueResult.Item.retryAttemptId === "string" &&
            issueResult.Item.retryAttemptId !== attemptId
          ) {
            throw new ProcessingAttemptConflictError(photoId);
          }
        }
        try {
          await documentClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: photoKey(userId, photoId),
              UpdateExpression:
                "SET processingState = :processing, processingAttemptId = :attemptId, processingStartedAt = :startedAt",
              ConditionExpression: "attribute_not_exists(processingAttemptId) AND attribute_not_exists(permanentDeletionReservationId)",
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
              ConditionExpression: "processingAttemptId = :attemptId AND attribute_not_exists(permanentDeletionReservationId)",
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

      async getTimelineProjections(collection) {
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: {
              ":pk": `USER#${userId}`,
              ":prefix": timelineProjectionPrefix(collection),
            },
          }),
        );
        return (result.Items ?? []).map((item) => toTimelineProjection(item, collection));
      },

      async getDateIndex(collection, year) {
        const result = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: dateIndexKey(userId, { collection, year }) }),
        );
        const { pk: _pk, sk: _sk, ...counts } = result.Item ?? {};
        return omitZeroCounts(counts as DateIndexPeriodCounts);
      },

      async queryTimelinePage({ collection, limit, after, atOrBefore }) {
        const prefix = timelineProjectionPrefix(collection);
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            ScanIndexForward: false,
            Limit: limit,
            ConsistentRead: true,
            ...(atOrBefore
              ? {
                  KeyConditionExpression: "pk = :pk AND sk BETWEEN :lower AND :upper",
                  ExpressionAttributeValues: {
                    ":pk": `USER#${userId}`,
                    ":lower": prefix,
                    ":upper": atOrBefore.sortKey,
                  },
                }
              : {
                  KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
                  ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":prefix": prefix },
                  ...(after
                    ? { ExclusiveStartKey: { pk: `USER#${userId}`, sk: after.sortKey } }
                    : {}),
                }),
          }),
        );
        const items = result.Items ?? [];
        const projections = items.map((item) => toTimelineProjection(item, collection));
        return {
          projections,
          ...(projections.length === limit && items.length > 0
            ? { lastSortKey: String(items[items.length - 1]!.sk) }
            : {}),
        };
      },

      async queryAdjacentProjection({ collection, capturedAt, addedAt, photoId, direction }) {
        const prefix = timelineProjectionPrefix(collection);
        const sortKey = timelineProjectionSortKey({ collection, capturedAt, addedAt, photoId });
        const scanIndexForward = direction === "newer";
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":prefix": prefix },
            ExclusiveStartKey: { pk: `USER#${userId}`, sk: sortKey },
            ScanIndexForward: scanIndexForward,
            ConsistentRead: true,
            Limit: 1,
          }),
        );
        const item = result.Items?.[0];
        return item ? toTimelineProjection(item, collection) : undefined;
      },

      async listDateIndexYears(collection) {
        const prefix = dateIndexPrefix(collection);
        const result = await documentClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":prefix": prefix },
          }),
        );
        return (result.Items ?? [])
          .map((item) => {
            const { pk: _pk, sk, ...counts } = item;
            return {
              year: Number(String(sk).slice(prefix.length)),
              counts: omitZeroCounts(counts as DateIndexPeriodCounts),
            };
          })
          .filter(({ counts }) => Object.keys(counts).length > 0);
      },

      async getProcessingIssuesSummary() {
        const result = await documentClient.send(
          new GetCommand({ TableName: tableName, Key: issueSummaryKey(userId) }),
        );
        return typeof result.Item?.openCount === "number" ? result.Item.openCount : 0;
      },

      async getPhotosByIds(photoIds) {
        return batchGetPhotos({ documentClient, tableName, userId, photoIds });
      },
    };
  },
});

const toTimelineProjection = (
  item: Record<string, unknown>,
  collection: PhotoCollection,
): TimelineProjection =>
  ({
    photoId: item.photoId,
    collection,
    capturedAt: item.capturedAt,
    addedAt: item.addedAt,
    fileName: item.fileName,
    displayDimensions: item.displayDimensions,
    timelineThumbnails: item.timelineThumbnails,
    favourite: Boolean(item.favourite),
  }) as TimelineProjection;

const updatePhoto = async (
  documentClient: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
  photoId: string,
  input: Pick<UpdateCommand["input"], "UpdateExpression" | "ConditionExpression" | "ExpressionAttributeNames" | "ExpressionAttributeValues">,
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
    typeof item.trashed !== "boolean" ||
    typeof item.favourite !== "boolean" ||
    typeof item.uploadLocalDateTime !== "string" ||
    typeof item.uploadContextTimeZone !== "string"
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
