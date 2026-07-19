import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CreateUploadBatchRequest,
  CreateUploadBatchResponse,
} from "@album/shared";
import {
  maxFilesPerUploadBatch,
  maxOriginalPhotoBytes,
  buildOriginalObjectKey,
  originalUploadMetadata,
  photoFormatForFile,
} from "@album/shared";
import { randomUUID } from "node:crypto";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { config } from "../config.js";
import { badRequest, ok } from "../http.js";
import type { PersonalAlbum } from "../store/personal-album.js";

const s3 = new S3Client({});

interface UploadFile {
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  clientSha256?: string;
  fileModifiedAt?: string;
}

interface CreateUploadBatchDeps {
  now: () => Date;
  newId: () => string;
  createUploadUrl: (input: {
    objectKey: string;
    contentType: string;
    metadata: Record<string, string>;
  }) => Promise<string>;
}

export const handler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleCreateUploadBatch({
    ...context,
    body: event.body,
    deps: {
      now: () => new Date(),
      newId: randomUUID,
      createUploadUrl: async ({ objectKey, contentType, metadata }) => {
        const command = new PutObjectCommand({
          Bucket: config.photosBucketName,
          Key: objectKey,
          ContentType: contentType,
          Metadata: metadata,
        });

        return getSignedUrl(s3, command, {
          expiresIn: config.uploadUrlExpiresInSeconds,
        });
      },
    },
  }),
);

export const handleCreateUploadBatch = async ({
  user,
  album,
  body,
  deps,
}: AuthedContext & {
  body: string | undefined;
  deps: CreateUploadBatchDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!body) {
    return badRequest("Missing request body");
  }

  const request = parseJson<CreateUploadBatchRequest>(body);
  if (!Array.isArray(request.files) || request.files.length === 0) {
    return badRequest("At least one file is required");
  }
  if (request.files.length > maxFilesPerUploadBatch) {
    return badRequest("Upload batches can contain at most 100 files");
  }
  if (request.files.some((file) => file.fileSizeBytes > maxOriginalPhotoBytes)) {
    return badRequest("Each file must be 50 MB or smaller");
  }
  if (request.files.some((file) => !photoFormatForFile(file))) {
    return badRequest("Files must be JPEG, PNG, or HEIC photos");
  }

  const uploadBatchId = deps.newId();
  const uploads: CreateUploadBatchResponse["uploads"] = [];
  const photoIds: string[] = [];
  const createdAt = deps.now().toISOString();

  for (const file of request.files) {
    const photoId = deps.newId();
    const keyParts = { userId: user.userId, uploadBatchId, photoId };
    const objectKey = buildOriginalObjectKey(keyParts);
    const fileModifiedAt = validIsoDate(file.fileModifiedAt);
    const metadata = removeEmptyMetadata({
      ...originalUploadMetadata(keyParts),
      "original-file-name": file.fileName,
      "client-sha256": file.clientSha256,
      "file-modified-at": fileModifiedAt,
    });

    const photo = {
      photoId,
      uploadBatchId,
      originalObjectKey: objectKey,
      fileName: file.fileName,
      format: photoFormatForFile(file) ?? "jpeg",
      contentType: file.contentType,
      fileSizeBytes: file.fileSizeBytes,
      ...(file.clientSha256 ? { clientSha256: file.clientSha256 } : {}),
      uploadRequestedAt: createdAt,
      ...(fileModifiedAt ? { fileModifiedAt } : {}),
    };
    await album.createPhoto(photo);

    uploads.push({
      photoId,
      objectKey,
      uploadUrl: await deps.createUploadUrl({
        objectKey,
        contentType: file.contentType,
        metadata,
      }),
      duplicate: false,
    });
    photoIds.push(photoId);
  }

  const batch = {
    uploadBatchId,
    createdAt,
    photoIds,
  };
  await album.createUploadBatch(batch);

  return ok({ uploadBatchId, uploads } satisfies CreateUploadBatchResponse);
};

const parseJson = <T>(body: string): T => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return { files: [] } as T;
  }
};

const removeEmptyMetadata = (
  metadata: Record<string, string | undefined>,
): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
};

const validIsoDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};
