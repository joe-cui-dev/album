import {
  FALLBACK_TIME_ZONE,
  buildExifDateTimeCandidate,
  deriveLocalDateTime,
  isValidIanaTimeZone,
  resolveOriginalCapturedAt,
} from "./chronology-extraction.js";

describe("isValidIanaTimeZone", () => {
  it.each(["Australia/Brisbane", "UTC", "America/New_York", "Pacific/Kiritimati"])(
    "accepts %s",
    (timeZone) => {
      expect(isValidIanaTimeZone(timeZone)).toBe(true);
    },
  );

  it.each(["Not/A_Zone", "GMT+10", "", "Brisbane"])("rejects %s", (timeZone) => {
    expect(isValidIanaTimeZone(timeZone)).toBe(false);
  });
});

describe("deriveLocalDateTime", () => {
  it("renders an instant in the given zone, normalized to seconds", () => {
    expect(deriveLocalDateTime("2026-07-19T00:30:00.000Z", "Australia/Brisbane")).toEqual({
      localDate: "2026-07-19",
      localTime: "10:30:00",
    });
  });

  it("crosses a day boundary correctly", () => {
    expect(deriveLocalDateTime("2026-07-19T23:00:00.000Z", "Australia/Brisbane")).toEqual({
      localDate: "2026-07-20",
      localTime: "09:00:00",
    });
  });

  it("crosses a year boundary correctly", () => {
    expect(deriveLocalDateTime("2025-12-31T23:30:00.000Z", "Australia/Brisbane")).toEqual({
      localDate: "2026-01-01",
      localTime: "09:30:00",
    });
  });

  it("handles the legacy fallback zone constant", () => {
    expect(deriveLocalDateTime("2026-01-01T00:00:00.000Z", FALLBACK_TIME_ZONE)).toEqual({
      localDate: "2026-01-01",
      localTime: "10:00:00",
    });
  });
});

describe("buildExifDateTimeCandidate", () => {
  it("returns undefined for a missing or unparseable tag", () => {
    expect(buildExifDateTimeCandidate(undefined)).toBeUndefined();
    expect(buildExifDateTimeCandidate({ dateTime: "not a date" })).toBeUndefined();
  });

  it("builds a second-resolution value with no subsecond tag", () => {
    expect(buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45" })).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45",
      timeResolution: "second",
    });
  });

  it("builds a subsecond-resolution value with a canonicalized subsecond tag", () => {
    expect(
      buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45", subSecTime: "1200" }),
    ).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45.12",
      timeResolution: "subsecond",
    });
  });

  it("treats an all-zero subsecond tag as exactly known (not absent)", () => {
    expect(
      buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45", subSecTime: "000" }),
    ).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45.0",
      timeResolution: "subsecond",
    });
  });

  it("drops an unparseable subsecond tag without failing the candidate", () => {
    expect(
      buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45", subSecTime: "abc" }),
    ).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45",
      timeResolution: "second",
    });
  });

  it("keeps a valid canonical offset", () => {
    expect(
      buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45", offset: "+10:00" }),
    ).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45",
      timeResolution: "second",
      offset: "+10:00",
    });
  });

  it("drops an invalid offset without discarding the local date and time", () => {
    expect(
      buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45", offset: "-00:00" }),
    ).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45",
      timeResolution: "second",
    });
    expect(
      buildExifDateTimeCandidate({ dateTime: "2024:06:15 09:30:45", offset: "not-an-offset" }),
    ).toEqual({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45",
      timeResolution: "second",
    });
  });

  it("advances to the next candidate on invalid calendar data (no rollover)", () => {
    expect(buildExifDateTimeCandidate({ dateTime: "2024:02:30 09:30:45" })).toBeUndefined();
    expect(buildExifDateTimeCandidate({ dateTime: "2024:13:01 09:30:45" })).toBeUndefined();
  });
});

describe("resolveOriginalCapturedAt", () => {
  const uploadLocalDateTime = { localDate: "2026-07-19", localTime: "10:00:00" };

  it("prefers a valid EXIF DateTimeOriginal", () => {
    const result = resolveOriginalCapturedAt({
      exifOriginal: { dateTime: "2024:06:15 09:30:45" },
      exifDigitized: { dateTime: "2024:06:16 09:30:45" },
      uploadLocalDateTime,
    });
    expect(result.source).toBe("exif");
    expect(result.capturedAt).toMatchObject({ localDate: "2024-06-15" });
  });

  it("falls back to EXIF DateTimeDigitized when Original is invalid", () => {
    const result = resolveOriginalCapturedAt({
      exifOriginal: { dateTime: "2024:02:30 09:30:45" },
      exifDigitized: { dateTime: "2024:06:16 09:30:45" },
      uploadLocalDateTime,
    });
    expect(result.source).toBe("exif");
    expect(result.capturedAt).toMatchObject({ localDate: "2024-06-16" });
  });

  it("falls back to file-modified local time when no EXIF is usable", () => {
    const result = resolveOriginalCapturedAt({
      fileModifiedLocalDateTime: { localDate: "2025-01-02", localTime: "08:00:00" },
      uploadLocalDateTime,
    });
    expect(result).toEqual({
      source: "fileModifiedTime",
      capturedAt: {
        precision: "dateTime",
        localDate: "2025-01-02",
        localTime: "08:00:00",
        timeResolution: "second",
      },
    });
  });

  it("falls back to upload local time as the last resort", () => {
    const result = resolveOriginalCapturedAt({ uploadLocalDateTime });
    expect(result).toEqual({
      source: "uploadTime",
      capturedAt: {
        precision: "dateTime",
        localDate: "2026-07-19",
        localTime: "10:00:00",
        timeResolution: "second",
      },
    });
  });

  it("pairs each timestamp with only its own offset and subsecond tags", () => {
    const result = resolveOriginalCapturedAt({
      exifOriginal: { dateTime: "2024:02:30 09:30:45", offset: "+01:00", subSecTime: "500" },
      exifDigitized: { dateTime: "2024:06:16 11:00:00" },
      uploadLocalDateTime,
    });
    expect(result.capturedAt).toEqual({
      precision: "dateTime",
      localDate: "2024-06-16",
      localTime: "11:00:00",
      timeResolution: "second",
    });
  });
});
