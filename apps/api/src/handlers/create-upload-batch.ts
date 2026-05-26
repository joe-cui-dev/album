import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CreateUploadBatchRequest,
  CreateUploadBatchResponse,
} from "@album/shared";
import { randomUUID } from "node:crypto";
import { getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, ok, unauthorized } from "../http.js";

const s3 = new S3Client({});
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const user = getAuthenticatedUser(event);
  if (!user) {
    return unauthorized();
  }

  if (!event.body) {
    return badRequest("Missing request body");
  }

  const request = parseJson<CreateUploadBatchRequest>(event.body);
  if (!Array.isArray(request.files) || request.files.length === 0) {
    return badRequest("At least one file is required");
  }

  const uploadBatchId = randomUUID();
  const uploads: CreateUploadBatchResponse["uploads"] = [];
  const photoIds: string[] = [];
  const createdAt = new Date().toISOString();

  for (const file of request.files) {
    const photoId = randomUUID();
    const objectKey = `users/${user.userId}/originals/${uploadBatchId}/${photoId}`;
    const command = new PutObjectCommand({
      Bucket: config.photosBucketName,
      Key: objectKey,
      ContentType: file.contentType,
      Metadata: {
        "user-id": user.userId,
        "upload-batch-id": uploadBatchId,
        "photo-id": photoId,
        "original-file-name": file.fileName,
        "client-sha256": file.clientSha256 ?? "",
        "file-modified-at": file.fileModifiedAt ?? "",
      },
    });

    uploads.push({
      photoId,
      objectKey,
      uploadUrl: await getSignedUrl(s3, command, {
        expiresIn: config.uploadUrlExpiresInSeconds,
      }),
      duplicate: false,
    });
    photoIds.push(photoId);
  }

  await dynamodb.send(
    new PutCommand({
      TableName: config.metadataTableName,
      Item: {
        pk: `USER#${user.userId}`,
        sk: `UPLOAD_BATCH#${createdAt}#${uploadBatchId}`,
        uploadBatchId,
        userId: user.userId,
        createdAt,
        photoIds,
      },
    }),
  );

  return ok({ uploadBatchId, uploads } satisfies CreateUploadBatchResponse);
};

const parseJson = <T>(body: string): T => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return { files: [] } as T;
  }
};
