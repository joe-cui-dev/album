export interface PresignedObjectUrl {
  url: string;
  expiresInSeconds: number;
}

export interface PhotoObjectStore {
  presignUpload(input: {
    objectKey: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<PresignedObjectUrl>;
  presignDownload(input: {
    objectKey: string;
    attachmentFileName?: string;
  }): Promise<PresignedObjectUrl>;
  readObjectMetadata(
    objectKey: string,
  ): Promise<Record<string, string | undefined>>;
  objectExists(objectKey: string): Promise<boolean>;
  readObjectBytes(objectKey: string): Promise<Uint8Array>;
  writeJpegObject(input: {
    objectKey: string;
    body: Uint8Array;
  }): Promise<void>;
}
