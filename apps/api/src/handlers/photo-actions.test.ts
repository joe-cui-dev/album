import {
  handleArchivePhoto,
  handleCreateDisplayAccessUrl,
  handleCreateOriginalDownloadUrl,
  handleGetPhotoDetail,
} from "./photo-actions.js";

const readyPhoto = {
  photoId: "photo-1",
  userId: "user-1",
  fileName: "beach.jpg",
  format: "jpeg",
  fileSizeBytes: 1234,
  originalObjectKey: "originals/user-1/batch-1/photo-1",
  displayObjectKey: "display/user-1/photo-1.jpg",
  capturedAt: "2025-01-02T10:00:00.000Z",
  capturedAtSource: "exif",
  processingState: "ready",
  archived: false,
  metadata: {
    width: 4000,
    height: 3000,
    cameraMake: "Canon",
  },
  displayDimensions: { width: 2048, height: 1536 },
} as const;

describe("photo action handlers", () => {
  it("returns read-only photo metadata for a signed-in user's photo", async () => {
    const response = await handleGetPhotoDetail({
      user: { userId: "user-1", email: "user@example.com" },
      photoId: "photo-1",
      deps: {
        getPhoto: async ({ userId, photoId }) => {
          expect({ userId, photoId }).toEqual({
            userId: "user-1",
            photoId: "photo-1",
          });
          return readyPhoto;
        },
      },
    });

    const body = JSON.parse(response.body ?? "{}");
    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      photoId: "photo-1",
      fileName: "beach.jpg",
      format: "jpeg",
      fileSizeBytes: 1234,
      capturedAt: "2025-01-02T10:00:00.000Z",
      capturedAtSource: "exif",
      processingState: "ready",
      archived: false,
      metadata: {
        width: 4000,
        height: 3000,
        cameraMake: "Canon",
      },
      displayDimensions: { width: 2048, height: 1536 },
    });
    expect(JSON.stringify(body).includes("originalObjectKey")).toBe(false);
    expect(JSON.stringify(body).includes("displayObjectKey")).toBe(false);
  });

  it("archives a signed-in user's photo", async () => {
    const archived: Array<{ userId: string; photoId: string }> = [];

    const response = await handleArchivePhoto({
      user: { userId: "user-1", email: "user@example.com" },
      photoId: "photo-1",
      deps: {
        getPhoto: async () => readyPhoto,
        archivePhoto: async (input) => {
          archived.push(input);
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      photoId: "photo-1",
      archived: true,
    });
    expect(archived).toEqual([{ userId: "user-1", photoId: "photo-1" }]);
  });

  it("creates a temporary display access URL only for ready photos with display output", async () => {
    const response = await handleCreateDisplayAccessUrl({
      user: { userId: "user-1", email: "user@example.com" },
      photoId: "photo-1",
      deps: {
        getPhoto: async () => readyPhoto,
        createTemporaryUrl: async ({ objectKey }) => {
          expect(objectKey).toBe("display/user-1/photo-1.jpg");
          return "https://temporary.example/display";
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      url: "https://temporary.example/display",
      expiresInSeconds: 300,
    });
  });

  it("creates a temporary original download URL for the signed-in user's original photo", async () => {
    const response = await handleCreateOriginalDownloadUrl({
      user: { userId: "user-1", email: "user@example.com" },
      photoId: "photo-1",
      deps: {
        getPhoto: async () => readyPhoto,
        createTemporaryUrl: async ({ objectKey, downloadFileName }) => {
          expect(objectKey).toBe("originals/user-1/batch-1/photo-1");
          expect(downloadFileName).toBe("beach.jpg");
          return "https://temporary.example/original";
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      url: "https://temporary.example/original",
      expiresInSeconds: 300,
    });
  });
});
