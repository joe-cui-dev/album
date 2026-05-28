import { describe, expect, it } from "vitest";
import { validatePhotoFile, validateUploadBatchFiles } from "./fileValidation.js";

const photo = (name: string, type: string, size = 1024) => {
  const file = new File(["x"], name, {
    type,
    lastModified: new Date("2026-01-02").getTime(),
  });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("validatePhotoFile", () => {
  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["photo.heic", "image/heic"],
    ["photo.heif", "image/heif"],
  ])("accepts %s with %s", (name, type) => {
    expect(validatePhotoFile(photo(name, type))).toEqual({ valid: true });
  });

  it("rejects unsupported file formats", () => {
    expect(validatePhotoFile(photo("notes.txt", "text/plain"))).toEqual({
      valid: false,
      reason: "JPEG, PNG, or HEIC photos only",
    });
  });

  it("rejects photos larger than 50 MB", () => {
    expect(validatePhotoFile(photo("large.jpg", "image/jpeg", 50 * 1024 * 1024 + 1))).toEqual({
      valid: false,
      reason: "50 MB maximum",
    });
  });

  it("rejects upload batches with more than 100 files", () => {
    const files = Array.from({ length: 101 }, (_, index) =>
      photo(`photo-${index}.jpg`, "image/jpeg"),
    );

    expect(validateUploadBatchFiles(files)).toEqual({
      valid: false,
      reason: "Choose 100 photos or fewer",
    });
  });
});
