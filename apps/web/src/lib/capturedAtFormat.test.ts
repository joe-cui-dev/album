import { describe, expect, it } from "vitest";
import type { CapturedAt } from "@album/shared";
import { formatCapturedAt, photoLinkName } from "./capturedAtFormat.js";

describe("formatCapturedAt", () => {
  it("formats a year-precision value with only the year", () => {
    const capturedAt: CapturedAt = { precision: "year", localDate: "2024" };
    expect(formatCapturedAt(capturedAt, "compact", "en-US")).toBe("2024");
  });

  it("formats a month-precision value without inventing a day", () => {
    const capturedAt: CapturedAt = { precision: "month", localDate: "2024-07" };
    expect(formatCapturedAt(capturedAt, "compact", "en-US")).toBe("Jul 2024");
    expect(formatCapturedAt(capturedAt, "accessible", "en-US")).toBe("July 2024");
  });

  it("formats a day-precision value without inventing a time", () => {
    const capturedAt: CapturedAt = { precision: "day", localDate: "2024-07-15" };
    expect(formatCapturedAt(capturedAt, "compact", "en-US")).toBe("Jul 15, 2024");
  });

  it("formats a dateTime value using the given wall-clock digits regardless of viewer time zone", () => {
    const capturedAt: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-07-15",
      localTime: "23:45",
      timeResolution: "minute",
    };
    expect(formatCapturedAt(capturedAt, "compact", "en-US")).toBe("Jul 15, 2024, 11:45 PM");
  });

  it("shows Capture Time Offset only in the detail preset and only when present", () => {
    const withOffset: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-07-15",
      localTime: "23:45:12",
      timeResolution: "second",
      offset: "+10:00",
    };
    expect(formatCapturedAt(withOffset, "detail", "en-US")).toBe("July 15, 2024 at 11:45:12 PM UTC+10:00");
    expect(formatCapturedAt(withOffset, "compact", "en-US")).not.toContain("UTC");

    const withoutOffset: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-07-15",
      localTime: "23:45:12",
      timeResolution: "second",
    };
    expect(formatCapturedAt(withoutOffset, "detail", "en-US")).not.toContain("UTC");
  });
});

describe("photoLinkName", () => {
  it("combines the file name with only known Captured At components", () => {
    const capturedAt: CapturedAt = { precision: "month", localDate: "2024-07" };
    expect(photoLinkName("beach.jpg", capturedAt)).toBe("beach.jpg, July 2024");
  });

  it("falls back to the file name alone when Captured At is entirely unknown", () => {
    expect(photoLinkName("beach.jpg", undefined)).toBe("beach.jpg");
  });
});
