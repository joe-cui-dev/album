import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PhotoObjectStore } from "./photo-objects.js";

const downloadUrlExpiresInSeconds = 300;

export const createS3PhotoObjectStore = ({
  s3Client = new S3Client({}),
  bucketName,
  uploadUrlExpiresInSeconds,
}: {
  s3Client?: S3Client;
  bucketName: string;
  uploadUrlExpiresInSeconds: number;
}): PhotoObjectStore => ({
  async deleteObjects(objectKeys) {
    if (objectKeys.length === 0) return;
    const result = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objectKeys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors && result.Errors.length > 0) {
      throw new Error(`S3 could not delete ${result.Errors.map(({ Key }) => Key ?? "an object").join(", ")}`);
    }
  },
  async presignUpload({ objectKey, contentType, metadata }) {
    const url = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        ContentType: contentType,
        Metadata: metadata,
      }),
      { expiresIn: uploadUrlExpiresInSeconds },
    );
    return { url, expiresInSeconds: uploadUrlExpiresInSeconds };
  },
  async presignDownload({ objectKey, attachmentFileName }) {
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        ...(attachmentFileName
          ? {
              ResponseContentDisposition: `attachment; filename="${attachmentFileName.replace(/["\\\r\n]/g, "_")}"`,
            }
          : {}),
      }),
      { expiresIn: downloadUrlExpiresInSeconds },
    );
    return { url, expiresInSeconds: downloadUrlExpiresInSeconds };
  },
  async readObjectMetadata(objectKey) {
    const result = await s3Client.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }),
    );
    return result.Metadata ?? {};
  },
  async objectExists(objectKey) {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  },
  async readObjectBytes(objectKey) {
    const result = await s3Client.send(
      new GetObjectCommand({ Bucket: bucketName, Key: objectKey }),
    );
    return result.Body ? result.Body.transformToByteArray() : new Uint8Array();
  },
  async writeJpegObject({ objectKey, body }) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: body,
        ContentType: "image/jpeg",
      }),
    );
  },
});
