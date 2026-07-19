import type { CreateUploadBatchRequest } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleCreateUploadBatch } from "./create-upload-batch.js";

const user = { userId: "user-1", email: "user@example.com" };
const validDeps = (store = createInMemoryPersonalAlbumStore()) => ({ store, now: () => new Date("2026-05-26T01:02:03.000Z"), newId: () => "unused", createUploadUrl: async () => "https://upload.example/photo" });

describe("handleCreateUploadBatch", () => {
  it("creates the upload batch and one canonical Photo per requested file", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const ids = ["batch-1", "photo-1", "photo-2"];
    const request: CreateUploadBatchRequest = { files: [
      { fileName: "beach.jpg", contentType: "image/jpeg", fileSizeBytes: 1024, clientSha256: "client-hash", fileModifiedAt: "2026-01-02T03:04:05.000Z" },
      { fileName: "scan.png", contentType: "image/png", fileSizeBytes: 2048 },
    ] };
    const response = await handleCreateUploadBatch({ user, body: JSON.stringify(request), deps: { ...validDeps(store), newId: () => ids.shift() ?? "extra", createUploadUrl: async ({ objectKey }) => `https://upload/${objectKey}` } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}") as { uploadBatchId: string; uploads: Array<{ photoId: string; objectKey: string; uploadUrl: string }> };
    expect(body.uploadBatchId).toBe("batch-1");
    expect(body.uploads).toEqual([
      { photoId: "photo-1", objectKey: "originals/user-1/batch-1/photo-1", uploadUrl: "https://upload/originals/user-1/batch-1/photo-1", duplicate: false },
      { photoId: "photo-2", objectKey: "originals/user-1/batch-1/photo-2", uploadUrl: "https://upload/originals/user-1/batch-1/photo-2", duplicate: false },
    ]);
    const album = store.personalAlbumOf("user-1");
    await expect(album.getPhoto("photo-1")).resolves.toMatchObject({ photoId: "photo-1", userId: "user-1", uploadBatchId: "batch-1", originalObjectKey: "originals/user-1/batch-1/photo-1", fileName: "beach.jpg", format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 1024, clientSha256: "client-hash", uploadRequestedAt: "2026-05-26T01:02:03.000Z", fileModifiedAt: "2026-01-02T03:04:05.000Z", processingState: "uploadRequested", archived: false });
    await expect(album.getPhoto("photo-2")).resolves.toMatchObject({ photoId: "photo-2", userId: "user-1", uploadBatchId: "batch-1", originalObjectKey: "originals/user-1/batch-1/photo-2", fileName: "scan.png", format: "png", contentType: "image/png", fileSizeBytes: 2048, uploadRequestedAt: "2026-05-26T01:02:03.000Z", processingState: "uploadRequested", archived: false });
    await expect(album.getUploadBatch("batch-1")).resolves.toEqual({ uploadBatchId: "batch-1", userId: "user-1", createdAt: "2026-05-26T01:02:03.000Z", photoIds: ["photo-1", "photo-2"] });
  });

  it("rejects upload batches with more than 100 files", async () => {
    const response = await handleCreateUploadBatch({ user, body: JSON.stringify({ files: Array.from({ length: 101 }, (_, index) => ({ fileName: `photo-${index}.jpg`, contentType: "image/jpeg", fileSizeBytes: 1024 })) } satisfies CreateUploadBatchRequest), deps: validDeps() });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ message: "Upload batches can contain at most 100 files" });
  });

  it("rejects files larger than 50 MB", async () => {
    const response = await handleCreateUploadBatch({ user, body: JSON.stringify({ files: [{ fileName: "too-large.jpg", contentType: "image/jpeg", fileSizeBytes: 50 * 1024 * 1024 + 1 }] } satisfies CreateUploadBatchRequest), deps: validDeps() });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ message: "Each file must be 50 MB or smaller" });
  });

  it("rejects files whose MIME type and extension are not a supported photo format", async () => {
    const response = await handleCreateUploadBatch({ user, body: JSON.stringify({ files: [{ fileName: "not-a-photo.gif", contentType: "image/gif", fileSizeBytes: 1024 }] } satisfies CreateUploadBatchRequest), deps: validDeps() });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ message: "Files must be JPEG, PNG, or HEIC photos" });
  });

  it("omits an invalid file modified time instead of storing it", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const inputs: unknown[] = [];
    const ids = ["batch-1", "photo-1"];
    const response = await handleCreateUploadBatch({ user, body: JSON.stringify({ files: [{ fileName: "photo.jpg", contentType: "image/jpeg", fileSizeBytes: 1024, fileModifiedAt: "not-a-date" }] } satisfies CreateUploadBatchRequest), deps: { ...validDeps(store), newId: () => ids.shift() ?? "extra", createUploadUrl: async (input) => { inputs.push(input); return "https://upload.example/photo"; } } });
    expect(response.statusCode).toBe(200);
    await expect(store.personalAlbumOf("user-1").getPhoto("photo-1")).resolves.not.toHaveProperty("fileModifiedAt");
    expect(inputs[0]).toEqual({ objectKey: "originals/user-1/batch-1/photo-1", contentType: "image/jpeg", metadata: { "user-id": "user-1", "upload-batch-id": "batch-1", "photo-id": "photo-1", "original-file-name": "photo.jpg" } });
  });
});
