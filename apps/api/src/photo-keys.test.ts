import {
  DISPLAY_KEY_PREFIX,
  ORIGINALS_KEY_PREFIX,
  TIMELINE_THUMBNAILS_KEY_PREFIX,
  buildDisplayObjectKey,
  buildOriginalObjectKey,
  buildTimelineThumbnailLargeObjectKey,
  buildTimelineThumbnailObjectKey,
  matchesOriginalObjectMetadata,
  originalUploadMetadata,
  parseOriginalObjectKey,
} from "@album/shared";

const parts = {
  userId: "user-1",
  uploadBatchId: "batch-1",
  photoId: "photo-1",
};

describe("photo object key contracts", () => {
  it("round-trips an original object key", () => {
    expect(parseOriginalObjectKey(buildOriginalObjectKey(parts))).toEqual(parts);
  });

  it("rejects an original object key that does not have exactly three parts", () => {
    expect(parseOriginalObjectKey("originals/user-1/batch-1")).toBeUndefined();
    expect(parseOriginalObjectKey("display/user-1/photo-1.jpg")).toBeUndefined();
    expect(parseOriginalObjectKey("originals/user-1/batch-1/photo-1/extra")).toBeUndefined();
  });

  it("matches the required original upload metadata and rejects a missing or mismatched value", () => {
    expect(matchesOriginalObjectMetadata(originalUploadMetadata(parts), parts)).toBe(true);
    expect(
      matchesOriginalObjectMetadata(
        { ...originalUploadMetadata(parts), "photo-id": undefined },
        parts,
      ),
    ).toBe(false);
    expect(
      matchesOriginalObjectMetadata(
        { ...originalUploadMetadata(parts), "upload-batch-id": "other-batch" },
        parts,
      ),
    ).toBe(false);
  });

  it("builds keys under their canonical prefix", () => {
    expect(buildOriginalObjectKey(parts).startsWith(ORIGINALS_KEY_PREFIX)).toBe(true);
    expect(buildDisplayObjectKey(parts).startsWith(DISPLAY_KEY_PREFIX)).toBe(true);
    expect(buildTimelineThumbnailObjectKey(parts).startsWith(TIMELINE_THUMBNAILS_KEY_PREFIX)).toBe(
      true,
    );
    expect(
      buildTimelineThumbnailLargeObjectKey(parts).startsWith(TIMELINE_THUMBNAILS_KEY_PREFIX),
    ).toBe(true);
  });
});
