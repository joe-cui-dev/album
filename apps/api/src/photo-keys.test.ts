import {
  buildOriginalObjectKey,
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
});
