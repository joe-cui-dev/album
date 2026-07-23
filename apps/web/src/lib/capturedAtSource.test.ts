import { describe, expect, it } from "vitest";
import { capturedAtSourceLabel } from "./capturedAtSource.js";

describe("capturedAtSourceLabel", () => {
  it.each([
    ["exif", "Date from photo"],
    ["fileModifiedTime", "Date from file"],
    ["uploadTime", "Date from upload"],
    ["userAdjusted", "Adjusted by you"],
  ] as const)("maps %s to the approved User-facing label", (source, label) => {
    expect(capturedAtSourceLabel(source)).toBe(label);
  });
});
