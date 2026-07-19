import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type {
  Photo,
  PhotoFormat,
  ProcessingState,
  UploadBatch,
} from "@album/shared";
import type { PersonalAlbum, PersonalAlbumStore } from "./personal-album.js";

const photoKey = (userId: string, photoId: string) => ({
  pk: `USER#${userId}`,
  sk: `PHOTO#${photoId}`,
});
const uploadBatchKey = (userId: string, uploadBatchId: string) => ({
  pk: `USER#${userId}`,
  sk: `UPLOAD_BATCH#${uploadBatchId}`,
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
  ["uploadRequested", "uploaded", "processing", "ready", "processingFailed", "exactDuplicate"].includes(value as ProcessingState);
