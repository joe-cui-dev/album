import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CreateUploadBatchRequest, CreateUploadBatchResponse } from "@album/shared";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { badRequest, ok } from "../http.js";

const s3 = new S3Client({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (!event.body) {
    return badRequest("Missing request body");
  }

  const request = JSON.parse(event.body) as CreateUploadBatchRequest;
  if (!Array.isArray(request.files) || request.files.length === 0) {
    return badRequest("At least one file is required");
  }

  const uploadBatchId = randomUUID();
  const uploads: CreateUploadBatchResponse["uploads"] = [];

  for (const file of request.files) {
    const photoId = randomUUID();
    const objectKey = `originals/${uploadBatchId}/${photoId}`;
    const command = new PutObjectCommand({
      Bucket: config.photosBucketName,
      Key: objectKey,
      ContentType: file.contentType,
      Metadata: {
        "original-file-name": file.fileName,
        "client-sha256": file.clientSha256 ?? "",
        "file-modified-at": file.fileModifiedAt ?? ""
      }
    });

    uploads.push({
      photoId,
      objectKey,
      uploadUrl: await getSignedUrl(s3, command, {
        expiresIn: config.uploadUrlExpiresInSeconds
      }),
      duplicate: false
    });
  }

  return ok({ uploadBatchId, uploads } satisfies CreateUploadBatchResponse);
};

