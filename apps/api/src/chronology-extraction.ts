import {
  validateCapturedAt,
  type CapturedAt,
  type CapturedAtTimeResolution,
  type OriginalCapturedAtSource,
} from "@album/shared";

/**
 * Legacy fallback zone (ADR-0034) reused for both migration backfill and any
 * new upload that arrives without an explicit upload-context time zone (an
 * old v1 client during rollout). Real EXIF and a supplied upload context
 * always take precedence; this only backstops the final fallback.
 */
export const LEGACY_FALLBACK_TIME_ZONE = "Australia/Brisbane";

export const isValidIanaTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** Derives the calendar date/time an instant reads as in an IANA zone, normalized to seconds. */
export const deriveLocalDateTime = (
  instant: string,
  timeZone: string,
): { localDate: string; localTime: string } => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  // Some environments render midnight as "24" under hour12: false.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${hour}:${parts.minute}:${parts.second}`,
  };
};

export interface ExifDateTimeCandidate {
  dateTime?: string;
  offset?: string;
  subSecTime?: string;
}

/** Trims trailing zeros to a bounded canonical subsecond representation, or drops an unusable value. */
const canonicalSubsecondDigits = (raw: string | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) {
    return undefined;
  }
  const trimmed = digits.slice(0, 6).replace(/0+$/, "");
  return trimmed.length > 0 ? trimmed : "0";
};

const canonicalOffsetCandidate = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed && /^[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : undefined;
};

/**
 * Builds a validated dateTime CapturedAt from one EXIF timestamp tag and its
 * own paired offset/subsecond tags. An invalid offset is dropped without
 * discarding an otherwise valid local date and time (ADR-0031); an invalid
 * calendar value (or unparseable/missing tag) yields undefined so the caller
 * advances to the next candidate (ADR-0032).
 */
export const buildExifDateTimeCandidate = (
  candidate: ExifDateTimeCandidate | undefined,
): CapturedAt | undefined => {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    candidate?.dateTime ?? "",
  );
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  const localDate = `${year}-${month}-${day}`;
  const subsecondDigits = canonicalSubsecondDigits(candidate?.subSecTime);
  const timeResolution: CapturedAtTimeResolution = subsecondDigits ? "subsecond" : "second";
  const localTime = subsecondDigits
    ? `${hour}:${minute}:${second}.${subsecondDigits}`
    : `${hour}:${minute}:${second}`;
  const offset = canonicalOffsetCandidate(candidate?.offset);

  const withOffset: CapturedAt = {
    precision: "dateTime",
    localDate,
    localTime,
    timeResolution,
    ...(offset ? { offset } : {}),
  };
  if (validateCapturedAt(withOffset).length === 0) {
    return withOffset;
  }

  const withoutOffset: CapturedAt = { precision: "dateTime", localDate, localTime, timeResolution };
  return validateCapturedAt(withoutOffset).length === 0 ? withoutOffset : undefined;
};

const secondResolutionCandidate = (localDateTime: {
  localDate: string;
  localTime: string;
}): CapturedAt => ({
  precision: "dateTime",
  localDate: localDateTime.localDate,
  localTime: localDateTime.localTime,
  timeResolution: "second",
});

/**
 * Resolves Original Captured At in EXIF-original -> EXIF-digitized ->
 * file-modified -> upload-time order (ADR-0032, ADR-0026), each candidate
 * fully validated before being accepted.
 */
export const resolveOriginalCapturedAt = (input: {
  exifOriginal?: ExifDateTimeCandidate;
  exifDigitized?: ExifDateTimeCandidate;
  fileModifiedLocalDateTime?: { localDate: string; localTime: string };
  uploadLocalDateTime: { localDate: string; localTime: string };
}): { capturedAt: CapturedAt; source: OriginalCapturedAtSource } => {
  const original = buildExifDateTimeCandidate(input.exifOriginal);
  if (original) {
    return { capturedAt: original, source: "exif" };
  }
  const digitized = buildExifDateTimeCandidate(input.exifDigitized);
  if (digitized) {
    return { capturedAt: digitized, source: "exif" };
  }
  if (input.fileModifiedLocalDateTime) {
    return {
      capturedAt: secondResolutionCandidate(input.fileModifiedLocalDateTime),
      source: "fileModifiedTime",
    };
  }
  return {
    capturedAt: secondResolutionCandidate(input.uploadLocalDateTime),
    source: "uploadTime",
  };
};
