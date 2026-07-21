import { createInMemoryPersonalAlbumStore } from "../store/in-memory-store.js";
import { handleGetProcessingIssuesSummary, handleListProcessingIssues } from "./processing-issues.js";

const user = { userId: "user-1", email: "user@example.com" };

describe("handleListProcessingIssues", () => {
  it("returns durable Issues newest Added At first with an opaque continuation", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf(user.userId);
    for (const [photoId, addedAt] of [
      ["older", "2026-01-01T00:00:00.000Z"],
      ["newer", "2026-02-01T00:00:00.000Z"],
    ] as const) {
      await album.createPhoto({
        photoId,
        uploadBatchId: "batch-1",
        originalObjectKey: `originals/user-1/batch-1/${photoId}`,
        fileName: `${photoId}.jpg`,
        format: "jpeg",
        contentType: "image/jpeg",
        fileSizeBytes: 42,
        uploadRequestedAt: addedAt,
      });
      await album.recordProcessingIssueV2({
        photoId,
        fileName: `${photoId}.jpg`,
        reasonCode: "unsupportedImage",
        attemptedAt: "2026-07-20T00:00:00.000Z",
      });
    }

    const first = await handleListProcessingIssues({ user, album, query: { limit: "1" } });
    expect(first.statusCode).toBe(200);
    expect(first.headers?.["cache-control"]).toBe("private, no-store");
    const firstBody = JSON.parse(first.body ?? "{}") as { issues: Array<{ photoId: string }>; nextCursor?: string };
    expect(firstBody.issues).toEqual([expect.objectContaining({ photoId: "newer", status: "failed" })]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await handleListProcessingIssues({
      user,
      album,
      query: { limit: "1", cursor: firstBody.nextCursor! },
    });
    expect(JSON.parse(second.body ?? "{}")).toMatchObject({
      issues: [expect.objectContaining({ photoId: "older" })],
    });
  });
});

describe("handleGetProcessingIssuesSummary", () => {
  it("returns the exact open count", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf(user.userId);
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
    });
    await album.recordProcessingIssueV2({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-01-01T00:01:00.000Z",
    });

    const response = await handleGetProcessingIssuesSummary({ user, album });
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["cache-control"]).toBe("private, no-store");
    expect(JSON.parse(response.body ?? "{}")).toEqual({ openCount: 1 });
  });

  it("returns zero for a brand new album", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf(user.userId);
    const response = await handleGetProcessingIssuesSummary({ user, album });
    expect(JSON.parse(response.body ?? "{}")).toEqual({ openCount: 0 });
  });
});
