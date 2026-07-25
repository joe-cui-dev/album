import type { CapturedAt } from "@album/shared";
import { createInMemoryPersonalAlbumStore } from "./in-memory-store.js";
import type { PersonalAlbum } from "./personal-album.js";

const dimensions = { width: 100, height: 50 };
const thumbnails = {
  small: { objectKey: "small.jpg", dimensions: { width: 320, height: 160 } },
  large: { objectKey: "large.jpg", dimensions: { width: 640, height: 320 } },
};

const createReadyPhoto = async (
  album: PersonalAlbum,
  photoId: string,
  capturedAt: CapturedAt,
  addedAt = "2026-01-01T00:00:00.000Z",
) => {
  await album.createPhoto({
    photoId,
    uploadBatchId: "batch-1",
    originalObjectKey: `originals/user-1/batch-1/${photoId}`,
    fileName: `${photoId}.jpg`,
    format: "jpeg",
    contentType: "image/jpeg",
    fileSizeBytes: 42,
    uploadRequestedAt: addedAt,
    uploadLocalDateTime: "2026-01-01T00:00:00",
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
    originalCapturedAt: capturedAt,
    originalCapturedAtSource: "exif",
    hadOpenProcessingIssue: false,
  });
};

const day = (localDate: string): CapturedAt => ({ precision: "day", localDate });

describe("queryTimelinePage", () => {
  it("returns pages newest first and a lastSortKey only when the page is full", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "jan", day("2024-01-01"));
    await createReadyPhoto(album, "jun", day("2024-06-15"));
    await createReadyPhoto(album, "dec", day("2024-12-31"));

    const firstPage = await album.queryTimelinePage({ collection: "active", limit: 2 });
    expect(firstPage.projections.map((p) => p.photoId)).toEqual(["dec", "jun"]);
    expect(firstPage.lastSortKey).toBeDefined();

    const secondPage = await album.queryTimelinePage({
      collection: "active",
      limit: 2,
      after: { sortKey: firstPage.lastSortKey! },
    });
    expect(secondPage.projections.map((p) => p.photoId)).toEqual(["jan"]);
    expect(secondPage.lastSortKey).toBeUndefined();
  });

  it("keeps Active and Archived collections independent", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "active-1", day("2024-01-01"));
    await createReadyPhoto(album, "archived-1", day("2024-02-01"));
    await album.setArchiveMembership({ photoId: "archived-1", archived: true });

    await expect(
      album.queryTimelinePage({ collection: "active", limit: 10 }),
    ).resolves.toMatchObject({ projections: [{ photoId: "active-1" }] });
    await expect(
      album.queryTimelinePage({ collection: "archived", limit: 10 }),
    ).resolves.toMatchObject({ projections: [{ photoId: "archived-1" }] });
  });

  it("anchors a continuous older stream at a startAt period without a hole", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "aug", day("2024-08-01"));
    await createReadyPhoto(album, "jun", day("2024-06-15"));
    await createReadyPhoto(album, "jan", day("2024-01-01"));

    const { timelinePeriodUpperBoundSortKey } = await import("./projection-keys.js");
    const anchored = await album.queryTimelinePage({
      collection: "active",
      limit: 10,
      atOrBefore: { sortKey: timelinePeriodUpperBoundSortKey("active", { year: 2024, month: 6 }) },
    });
    expect(anchored.projections.map((p) => p.photoId)).toEqual(["jun", "jan"]);
  });

  it("no-change traversal: repeating the same page returns the same photos", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "a", day("2024-01-01"));
    await createReadyPhoto(album, "b", day("2024-01-02"));

    const first = await album.queryTimelinePage({ collection: "active", limit: 10 });
    const second = await album.queryTimelinePage({ collection: "active", limit: 10 });
    expect(second.projections).toEqual(first.projections);
  });

  it("live insertion of a newer Photo appears ahead of an in-progress older cursor", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "old", day("2024-01-01"));
    const firstPage = await album.queryTimelinePage({ collection: "active", limit: 1 });
    expect(firstPage.projections.map((p) => p.photoId)).toEqual(["old"]);

    await createReadyPhoto(album, "new", day("2024-06-01"));

    // Continuing strictly after "old" never re-surfaces it or the new newer Photo.
    const nextPage = await album.queryTimelinePage({
      collection: "active",
      limit: 10,
      after: { sortKey: firstPage.lastSortKey! },
    });
    expect(nextPage.projections).toEqual([]);
  });
});

describe("listDateIndexYears", () => {
  it("lists only non-empty years, sorted ascending", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "y2024", day("2024-06-15"));
    await createReadyPhoto(album, "y2020", day("2020-01-01"));

    await expect(album.listDateIndexYears("active")).resolves.toEqual([
      { year: 2020, counts: { "01": 1 } },
      { year: 2024, counts: { "06": 1 } },
    ]);
    await expect(album.listDateIndexYears("archived")).resolves.toEqual([]);
  });

  it("omits a year whose counters were all transferred away", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "solo", day("2024-06-15"));
    await album.setArchiveMembership({ photoId: "solo", archived: true });

    await expect(album.listDateIndexYears("active")).resolves.toEqual([]);
    await expect(album.listDateIndexYears("archived")).resolves.toEqual([
      { year: 2024, counts: { "06": 1 } },
    ]);
  });

  it("omits a zero-valued month within a year that still has other nonzero months", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "june-photo", day("2024-06-15"));
    await createReadyPhoto(album, "july-photo", day("2024-07-01"));
    await album.setArchiveMembership({ photoId: "july-photo", archived: true });

    await expect(album.listDateIndexYears("active")).resolves.toEqual([
      { year: 2024, counts: { "06": 1 } },
    ]);
    await expect(album.getDateIndex("active", 2024)).resolves.toEqual({ "06": 1 });
  });
});

describe("getProcessingIssuesSummary", () => {
  it("tracks the exact open count across create/resolve", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await album.createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo-1.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 42,
      uploadRequestedAt: "2026-01-01T00:00:00.000Z",
      uploadLocalDateTime: "2026-01-01T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    await expect(album.getProcessingIssuesSummary()).resolves.toBe(0);

    await album.recordProcessingIssue({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-01-01T00:01:00.000Z",
    });
    await expect(album.getProcessingIssuesSummary()).resolves.toBe(1);

    await album.publishReadyPhoto({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      sha256: "hash",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: dimensions,
      timelineThumbnails: thumbnails,
      metadata: {},
      originalCapturedAt: day("2024-06-15"),
      originalCapturedAtSource: "exif",
      hadOpenProcessingIssue: true,
    });
    await expect(album.getProcessingIssuesSummary()).resolves.toBe(0);
  });
});

describe("queryAdjacentProjection", () => {
  it("finds the nearest newer and older neighbours in collection order", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "jan", day("2024-01-01"));
    await createReadyPhoto(album, "jun", day("2024-06-15"));
    await createReadyPhoto(album, "dec", day("2024-12-31"));

    await expect(
      album.queryAdjacentProjection({
        collection: "active",
        capturedAt: day("2024-06-15"),
        addedAt: "2026-01-01T00:00:00.000Z",
        photoId: "jun",
        direction: "newer",
      }),
    ).resolves.toMatchObject({ photoId: "dec" });

    await expect(
      album.queryAdjacentProjection({
        collection: "active",
        capturedAt: day("2024-06-15"),
        addedAt: "2026-01-01T00:00:00.000Z",
        photoId: "jun",
        direction: "older",
      }),
    ).resolves.toMatchObject({ photoId: "jan" });
  });

  it("returns undefined past either end of the sequence", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "solo", day("2024-06-15"));

    await expect(
      album.queryAdjacentProjection({
        collection: "active",
        capturedAt: day("2024-06-15"),
        addedAt: "2026-01-01T00:00:00.000Z",
        photoId: "solo",
        direction: "newer",
      }),
    ).resolves.toBeUndefined();
    await expect(
      album.queryAdjacentProjection({
        collection: "active",
        capturedAt: day("2024-06-15"),
        addedAt: "2026-01-01T00:00:00.000Z",
        photoId: "solo",
        direction: "older",
      }),
    ).resolves.toBeUndefined();
  });

  it("never crosses into the other collection", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "active-1", day("2024-01-01"));
    await createReadyPhoto(album, "archived-1", day("2024-02-01"));
    await album.setArchiveMembership({ photoId: "archived-1", archived: true });

    await expect(
      album.queryAdjacentProjection({
        collection: "active",
        capturedAt: day("2024-01-01"),
        addedAt: "2026-01-01T00:00:00.000Z",
        photoId: "active-1",
        direction: "newer",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("getPhotosByIds", () => {
  it("returns the matching Photos and silently omits missing ids", async () => {
    const album = createInMemoryPersonalAlbumStore().personalAlbumOf("user-1");
    await createReadyPhoto(album, "a", day("2024-01-01"));
    await createReadyPhoto(album, "b", day("2024-01-02"));

    const result = await album.getPhotosByIds(["a", "missing", "b"]);
    expect(result.map((photo) => photo.photoId).sort()).toEqual(["a", "b"]);
  });
});
