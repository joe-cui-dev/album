import type { PhotoObjectStore } from "./photo-objects.js";

interface InMemoryPhotoObject {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
  metadata: Record<string, string | undefined>;
}

export const createInMemoryPhotoObjectStore = (
  initialObjects: InMemoryPhotoObject[] = [],
): PhotoObjectStore => {
  const objects = new Map(
    initialObjects.map(({ objectKey, body, contentType, metadata }) => [
      objectKey,
      { body, contentType, metadata },
    ]),
  );

  return {
    async presignUpload({ objectKey }) {
      return {
        url: `https://photo-objects.invalid/${encodeURIComponent(objectKey)}`,
        expiresInSeconds: 900,
      };
    },
    async presignDownload({ objectKey }) {
      return {
        url: `https://photo-objects.invalid/${encodeURIComponent(objectKey)}`,
        expiresInSeconds: 300,
      };
    },
    async readObjectMetadata(objectKey) {
      return objects.get(objectKey)?.metadata ?? {};
    },
    async objectExists(objectKey) {
      return objects.has(objectKey);
    },
    async readObjectBytes(objectKey) {
      return objects.get(objectKey)?.body ?? new Uint8Array();
    },
    async writeJpegObject({ objectKey, body }) {
      objects.set(objectKey, {
        body,
        contentType: "image/jpeg",
        metadata: {},
      });
    },
  };
};
