import type { CapturedAt } from "@album/shared";
import { ProcessingAttemptConflictError, StaleChronologyRevisionError } from "./errors.js";
import { createInMemoryPersonalAlbumStore } from "./in-memory-store.js";
import type { PersonalAlbum } from "./personal-album.js";

const june15: CapturedAt = { precision: "day", localDate: "2024-06-15" };
const july04: CapturedAt = { precision: "day", localDate: "2024-07-04" };
const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "timeline-thumbnails/user-1/photo-1.jpg", dimensions: { width: 320, height: 160 } },
  large: { objectKey: "timeline-thumbnails/user-1/photo-1-large.jpg", dimensions: { width: 640, height: 320 } },
};

const createReadyPhoto = async (
  album: PersonalAlbum,
  photoId: string,
  input: Partial<Parameters<PersonalAlbum["publishReadyPhoto"]>[0]> = {},
) => {
  await album.createPhoto({
    photoId,
    uploadBatchId: "batch-1",
    originalObjectKey: `originals/user-1/batch-1/${photoId}`,
    fileName: `${photoId}.jpg`,
    format: "jpeg",
    contentType: "image/jpeg",
    fileSizeBytes: 42,
    uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
  });
  await album.publishReadyPhoto({
    photoId,
    fileName: `${photoId}.jpg`,
    sha256: `${photoId}-hash`,
    displayObjectKey: `display/user-1/${photoId}.jpg`,
    displayDimensions: dimensions,
    timelineThumbnails: thumbnails,
    metadata: {},
    originalCapturedAt: june15,
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
    ...input,
  });
};

describe("PersonalAlbum contract", () => {
  it("round-trips a created Photo through its User's Personal Album", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");

    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "summer.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });

    expect(await album.getPhoto("photo-1")).toMatchObject({
      photoId: "photo-1",
      userId: "user-1",
      processingState: "uploadRequested",
      archived: false,
    });
  });

  it("keeps a User's Photos isolated from another User's Personal Album and lets Sha256 lookups exclude a candidate", async () => {
    const store = createInMemoryPersonalAlbumStore();
    const album = store.personalAlbumOf("user-1");
    const otherAlbum = store.personalAlbumOf("user-2");
    await createReadyPhoto(album, "old");
    await createReadyPhoto(album, "new");

    await expect(otherAlbum.getPhoto("old")).resolves.toBeUndefined();
    await expect(
      album.findReadyPhotoBySha256({ sha256: "new-hash", excludePhotoId: "old" }),
    ).resolves.toEqual({ photoId: "new" });
    await expect(
      album.findReadyPhotoBySha256({ sha256: "new-hash", excludePhotoId: "new" }),
    ).resolves.toBeUndefined();
  });
});

describe("PersonalAlbum contract: publishReadyPhoto", () => {
  it("sets original/active chronology at revision 0 and writes the Active projection and Date Index", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");

    const photo = await album.getPhoto("photo-1");
    expect(photo?.chronology).toEqual({
      original: { capturedAt: june15, source: "exif" },
      active: { capturedAt: june15, source: "exif", revision: 0 },
    });
    expect(photo?.timelineThumbnails).toEqual(thumbnails);

    const projections = await album.getTimelineProjections("active");
    expect(projections).toEqual([
      expect.objectContaining({ photoId: "photo-1", collection: "active", capturedAt: june15 }),
    ]);
    expect(await album.getTimelineProjections("archived")).toEqual([]);

    expect(await album.getDateIndex("active", 2024)).toEqual({ "06": 1 });
  });

  it("resolves an open Processing Issue and decrements the exact open count", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.recordProcessingIssue({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-07-19T00:01:00.000Z",
    });
    expect(await album.getProcessingIssue("photo-1")).toBeDefined();

    await createReadyPhoto(album, "photo-1", { hadOpenProcessingIssue: true });

    expect(await album.getProcessingIssue("photo-1")).toBeUndefined();
  });

  it("rejects a publish from an attempt that no longer owns the Photo", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.claimProcessingAttempt({
      photoId: "photo-1",
      attemptId: "attempt-A",
      startedAt: "2026-07-19T00:00:01.000Z",
    });

    await expect(
      createReadyPhoto(album, "photo-1", { attemptId: "attempt-B" }),
    ).rejects.toBeInstanceOf(ProcessingAttemptConflictError);
  });
});

describe("PersonalAlbum contract: publishExactDuplicate", () => {
  it("marks the Photo as an Exact Duplicate without creating a projection", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-2",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-2",
      fileName: "photo-2.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });

    await album.publishExactDuplicate({
      photoId: "photo-2",
      sha256: "dup-hash",
      duplicateOfPhotoId: "photo-1",
      hadOpenProcessingIssue: false,
    });

    const photo = await album.getPhoto("photo-2");
    expect(photo?.processingState).toBe("exactDuplicate");
    expect(await album.getTimelineProjections("active")).toEqual([]);
  });
});

describe("PersonalAlbum contract: setArchiveMembership", () => {
  it("moves a Ready Photo between collections and transfers its Date Index count", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");

    await album.setArchiveMembership({ photoId: "photo-1", archived: true });

    expect(await album.getTimelineProjections("active")).toEqual([]);
    expect(await album.getTimelineProjections("archived")).toEqual([
      expect.objectContaining({ photoId: "photo-1", collection: "archived" }),
    ]);
    expect(await album.getDateIndex("active", 2024)).toEqual({});
    expect(await album.getDateIndex("archived", 2024)).toEqual({ "06": 1 });
    expect((await album.getPhoto("photo-1"))?.archived).toBe(true);
  });

  it("is idempotent when the Photo is already in the target collection", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");

    await album.setArchiveMembership({ photoId: "photo-1", archived: false });

    expect(await album.getDateIndex("active", 2024)).toEqual({ "06": 1 });
    expect(await album.getTimelineProjections("active")).toHaveLength(1);
  });

  it("moves Restore (Archived -> Active) symmetrically", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");
    await album.setArchiveMembership({ photoId: "photo-1", archived: true });

    await album.setArchiveMembership({ photoId: "photo-1", archived: false });

    expect(await album.getDateIndex("active", 2024)).toEqual({ "06": 1 });
    expect(await album.getDateIndex("archived", 2024)).toEqual({});
    expect((await album.getPhoto("photo-1"))?.archived).toBe(false);
  });
});

describe("PersonalAlbum contract: replaceActiveChronology (Adjust Captured At)", () => {
  it("moves the projection and Date Index count to the new period and bumps the revision", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");

    const result = await album.replaceActiveChronology({
      photoId: "photo-1",
      capturedAt: july04,
      expectedRevision: 0,
    });

    expect(result).toEqual({ revision: 1 });
    expect(await album.getDateIndex("active", 2024)).toEqual({ "07": 1 });
    const photo = await album.getPhoto("photo-1");
    expect(photo?.chronology?.active).toEqual({ capturedAt: july04, source: "userAdjusted", revision: 1 });
    expect(photo?.chronology?.original).toEqual({ capturedAt: june15, source: "exif" });
  });

  it("does not advance the revision on an identical retry", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");
    await album.replaceActiveChronology({ photoId: "photo-1", capturedAt: july04, expectedRevision: 0 });

    const result = await album.replaceActiveChronology({
      photoId: "photo-1",
      capturedAt: july04,
      expectedRevision: 1,
    });

    expect(result).toEqual({ revision: 1 });
    expect(await album.getDateIndex("active", 2024)).toEqual({ "07": 1 });
  });

  it("throws StaleChronologyRevisionError when expectedRevision is stale", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");
    await album.replaceActiveChronology({ photoId: "photo-1", capturedAt: july04, expectedRevision: 0 });

    await expect(
      album.replaceActiveChronology({ photoId: "photo-1", capturedAt: june15, expectedRevision: 0 }),
    ).rejects.toBeInstanceOf(StaleChronologyRevisionError);
  });

  it("moves the projection within an Archived Photo without changing its collection", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");
    await album.setArchiveMembership({ photoId: "photo-1", archived: true });

    await album.replaceActiveChronology({ photoId: "photo-1", capturedAt: july04, expectedRevision: 0 });

    expect(await album.getTimelineProjections("archived")).toEqual([
      expect.objectContaining({ photoId: "photo-1", capturedAt: july04 }),
    ]);
    expect(await album.getTimelineProjections("active")).toEqual([]);
  });
});

describe("PersonalAlbum contract: revertActiveChronology", () => {
  it("restores the original value, source, and Date Index period", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");
    await album.replaceActiveChronology({ photoId: "photo-1", capturedAt: july04, expectedRevision: 0 });

    const result = await album.revertActiveChronology({ photoId: "photo-1", expectedRevision: 1 });

    expect(result).toEqual({ revision: 2 });
    const photo = await album.getPhoto("photo-1");
    expect(photo?.chronology?.active).toEqual({ capturedAt: june15, source: "exif", revision: 2 });
    expect(await album.getDateIndex("active", 2024)).toEqual({ "06": 1 });
  });

  it("is a no-op that does not advance the revision when already at the original value", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");

    const result = await album.revertActiveChronology({ photoId: "photo-1", expectedRevision: 0 });

    expect(result).toEqual({ revision: 0 });
  });

  it("throws StaleChronologyRevisionError when expectedRevision is stale", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "photo-1");

    await expect(
      album.revertActiveChronology({ photoId: "photo-1", expectedRevision: 5 }),
    ).rejects.toBeInstanceOf(StaleChronologyRevisionError);
  });
});

describe("PersonalAlbum contract: Processing Issues", () => {
  it("creates an Issue on first failure and increments the open count", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });

    await album.recordProcessingIssue({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-07-19T00:01:00.000Z",
    });

    expect(await album.getProcessingIssue("photo-1")).toEqual({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      status: "failed",
      addedAt: "2026-07-19T00:00:00.000Z",
      firstOpenedAt: "2026-07-19T00:01:00.000Z",
      attemptCount: 1,
      lastAttemptAt: "2026-07-19T00:01:00.000Z",
    });
    expect((await album.getPhoto("photo-1"))?.processingState).toBe("processingFailed");
  });

  it("updates an existing Issue on repeated failure without creating a second Issue", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.recordProcessingIssue({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-07-19T00:01:00.000Z",
    });

    await album.recordProcessingIssue({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "corruptFile",
      attemptedAt: "2026-07-19T00:02:00.000Z",
    });

    expect(await album.getProcessingIssue("photo-1")).toEqual({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "corruptFile",
      status: "failed",
      addedAt: "2026-07-19T00:00:00.000Z",
      firstOpenedAt: "2026-07-19T00:01:00.000Z",
      attemptCount: 2,
      lastAttemptAt: "2026-07-19T00:02:00.000Z",
    });
  });
});

describe("PersonalAlbum contract: claimProcessingAttempt", () => {
  it("claims a fresh attempt, resumes the same attempt, and rejects a conflicting attempt", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });

    await expect(
      album.claimProcessingAttempt({ photoId: "photo-1", attemptId: "attempt-A", startedAt: "t1" }),
    ).resolves.toBe("claimed");
    await expect(
      album.claimProcessingAttempt({ photoId: "photo-1", attemptId: "attempt-A", startedAt: "t2" }),
    ).resolves.toBe("resumed");
    await expect(
      album.claimProcessingAttempt({ photoId: "photo-1", attemptId: "attempt-B", startedAt: "t3" }),
    ).rejects.toBeInstanceOf(ProcessingAttemptConflictError);
  });

  it("admits only the retry attempt reserved before its SQS message is sent", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1", uploadBatchId: "batch-1", originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg", format: "jpeg", contentType: "image/jpeg", fileSizeBytes: 42,
      uploadRequestedAt: "2026-07-20T00:00:00.000Z",
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await album.recordProcessingIssue({
      photoId: "photo-1", fileName: "photo-1.jpg", reasonCode: "failed", attemptedAt: "2026-07-20T00:01:00.000Z",
    });
    await album.reserveProcessingIssueRetry({
      photoId: "photo-1", retryAttemptId: "attempt-A",
      reservedAt: "2026-07-20T00:01:00.000Z", reservationExpiresAt: "2026-07-20T00:06:00.000Z",
    });
    await expect(album.claimProcessingAttempt({ photoId: "photo-1", attemptId: "attempt-B", startedAt: "t" }))
      .rejects.toBeInstanceOf(ProcessingAttemptConflictError);
    await expect(album.claimProcessingAttempt({ photoId: "photo-1", attemptId: "attempt-A", startedAt: "t" }))
      .resolves.toBe("claimed");
  });
});
