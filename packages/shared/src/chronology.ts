export type CapturedAtPrecision = "year" | "month" | "day" | "dateTime";
export type CapturedAtTimeResolution = "minute" | "second" | "subsecond";

export interface YearCapturedAt {
  precision: "year";
  localDate: string;
}

export interface MonthCapturedAt {
  precision: "month";
  localDate: string;
}

export interface DayCapturedAt {
  precision: "day";
  localDate: string;
}

export interface DateTimeCapturedAt {
  precision: "dateTime";
  localDate: string;
  localTime: string;
  timeResolution: CapturedAtTimeResolution;
  offset?: string;
}

export type CapturedAt =
  | YearCapturedAt
  | MonthCapturedAt
  | DayCapturedAt
  | DateTimeCapturedAt;

export type CapturedAtSource =
  | "exif"
  | "fileModifiedTime"
  | "uploadTime"
  | "userAdjusted";

export type OriginalCapturedAtSource = Exclude<CapturedAtSource, "userAdjusted">;

export interface CapturedAtValidationError {
  path: string;
  message: string;
}

const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_TIME_PATTERN = /^\d{2}:\d{2}$/;
const SECOND_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;
const SUBSECOND_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}\.\d{1,6}$/;
const OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] as number);

interface ParsedLocalDate {
  year: number;
  month?: number;
  day?: number;
}

const validateLocalDateForPrecision = (
  precision: CapturedAtPrecision,
  localDate: string,
  errors: CapturedAtValidationError[],
): ParsedLocalDate | undefined => {
  if (precision === "year") {
    if (!YEAR_PATTERN.test(localDate)) {
      errors.push({ path: "localDate", message: "must match YYYY" });
      return undefined;
    }
    const year = Number(localDate);
    if (year < 1) {
      errors.push({ path: "localDate", message: "year must be between 0001 and 9999" });
      return undefined;
    }
    return { year };
  }

  if (precision === "month") {
    if (!MONTH_PATTERN.test(localDate)) {
      errors.push({ path: "localDate", message: "must match YYYY-MM" });
      return undefined;
    }
    const [yearStr, monthStr] = localDate.split("-") as [string, string];
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (year < 1) {
      errors.push({ path: "localDate", message: "year must be between 0001 and 9999" });
      return undefined;
    }
    if (month < 1 || month > 12) {
      errors.push({ path: "localDate", message: "month must be between 01 and 12" });
      return undefined;
    }
    return { year, month };
  }

  if (!DAY_PATTERN.test(localDate)) {
    errors.push({ path: "localDate", message: "must match YYYY-MM-DD" });
    return undefined;
  }
  const [yearStr, monthStr, dayStr] = localDate.split("-") as [string, string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (year < 1) {
    errors.push({ path: "localDate", message: "year must be between 0001 and 9999" });
    return undefined;
  }
  if (month < 1 || month > 12) {
    errors.push({ path: "localDate", message: "month must be between 01 and 12" });
    return undefined;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    errors.push({
      path: "localDate",
      message: "day is not valid for the given month and year",
    });
    return undefined;
  }
  return { year, month, day };
};

const timePatternForResolution = (
  resolution: CapturedAtTimeResolution,
): RegExp =>
  resolution === "minute"
    ? MINUTE_TIME_PATTERN
    : resolution === "second"
      ? SECOND_TIME_PATTERN
      : SUBSECOND_TIME_PATTERN;

const validateLocalTime = (
  resolution: CapturedAtTimeResolution,
  localTime: string,
  errors: CapturedAtValidationError[],
): boolean => {
  const pattern = timePatternForResolution(resolution);
  if (!pattern.test(localTime)) {
    errors.push({
      path: "localTime",
      message: `must match the format for ${resolution} resolution`,
    });
    return false;
  }

  const [hourStr, minuteStr, secondPart] = localTime.split(":") as [
    string,
    string,
    string | undefined,
  ];
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (hour > 23) {
    errors.push({ path: "localTime", message: "hour must be between 00 and 23" });
    return false;
  }
  if (minute > 59) {
    errors.push({ path: "localTime", message: "minute must be between 00 and 59" });
    return false;
  }
  if (resolution === "minute") {
    return true;
  }

  const secondSegments = (secondPart as string).split(".");
  const second = Number(secondSegments[0]);
  if (second > 59) {
    errors.push({ path: "localTime", message: "second must be between 00 and 59" });
    return false;
  }
  if (resolution === "subsecond") {
    const fractional = secondSegments[1] as string;
    if (fractional.length > 1 && fractional.endsWith("0")) {
      errors.push({
        path: "localTime",
        message: "subsecond digits must use the shortest canonical form (no trailing zero)",
      });
      return false;
    }
  }
  return true;
};

const validateOffset = (
  offset: string,
  errors: CapturedAtValidationError[],
): void => {
  if (!OFFSET_PATTERN.test(offset)) {
    errors.push({ path: "offset", message: "must match +HH:mm or -HH:mm" });
    return;
  }
  const sign = offset[0];
  const [hourStr, minuteStr] = offset.slice(1).split(":") as [string, string];
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (minute > 59) {
    errors.push({ path: "offset", message: "offset minute must be between 00 and 59" });
    return;
  }
  const totalMinutes = hour * 60 + minute;
  if (totalMinutes === 0 && sign === "-") {
    errors.push({ path: "offset", message: "zero offset must be written as +00:00" });
    return;
  }
  if (totalMinutes > 14 * 60 || (sign === "-" && totalMinutes > 12 * 60)) {
    errors.push({ path: "offset", message: "offset must be between -12:00 and +14:00" });
  }
};

const validateDateTimeFields = (
  record: Record<string, unknown>,
  errors: CapturedAtValidationError[],
): void => {
  const timeResolution = record.timeResolution;
  if (
    timeResolution !== "minute" &&
    timeResolution !== "second" &&
    timeResolution !== "subsecond"
  ) {
    errors.push({
      path: "timeResolution",
      message: "must be one of minute, second, subsecond",
    });
    return;
  }

  const localTime = record.localTime;
  if (typeof localTime !== "string") {
    errors.push({ path: "localTime", message: "must be a string" });
    return;
  }

  if (!validateLocalTime(timeResolution, localTime, errors)) {
    return;
  }

  const offset = record.offset;
  if (offset !== undefined) {
    if (typeof offset !== "string") {
      errors.push({ path: "offset", message: "must be a string" });
    } else {
      validateOffset(offset, errors);
    }
  }
};

/** Runtime validator: never uses JS `Date` so partial calendar values and
 * offset-free local times are never silently reinterpreted. */
export const validateCapturedAt = (
  value: unknown,
): CapturedAtValidationError[] => {
  if (typeof value !== "object" || value === null) {
    return [{ path: "", message: "must be an object" }];
  }
  const record = value as Record<string, unknown>;
  const precision = record.precision;
  if (
    precision !== "year" &&
    precision !== "month" &&
    precision !== "day" &&
    precision !== "dateTime"
  ) {
    return [
      { path: "precision", message: "must be one of year, month, day, dateTime" },
    ];
  }

  const errors: CapturedAtValidationError[] = [];
  const localDate = record.localDate;
  if (typeof localDate !== "string") {
    errors.push({ path: "localDate", message: "must be a string" });
  } else {
    validateLocalDateForPrecision(precision, localDate, errors);
  }

  if (precision === "dateTime") {
    validateDateTimeFields(record, errors);
  } else {
    for (const key of ["localTime", "timeResolution", "offset"] as const) {
      if (record[key] !== undefined) {
        errors.push({
          path: key,
          message: `must not be present for ${precision} precision`,
        });
      }
    }
  }

  const allowedKeys =
    precision === "dateTime"
      ? new Set(["precision", "localDate", "localTime", "timeResolution", "offset"])
      : new Set(["precision", "localDate"]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      errors.push({ path: key, message: "unexpected property" });
    }
  }

  return errors;
};

export const isCapturedAt = (value: unknown): value is CapturedAt =>
  validateCapturedAt(value).length === 0;

/** Structural equality without JS `Date`; ignores nothing -- an offset
 * difference is a real difference even though it never affects ordering. */
export const isSameCapturedAt = (a: CapturedAt, b: CapturedAt): boolean => {
  if (a.precision !== b.precision || a.localDate !== b.localDate) {
    return false;
  }
  if (a.precision === "dateTime" && b.precision === "dateTime") {
    return (
      a.localTime === b.localTime &&
      a.timeResolution === b.timeResolution &&
      a.offset === b.offset
    );
  }
  return true;
};

export interface CapturedAtComponents {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
  /** Zero-padded to 6 digits (bounded microsecond precision); only set for subsecond resolution. */
  subsecondDigits?: string;
}

/** Formatter-safe accessor: extracts known calendar/time components without
 * constructing a JS `Date`, which cannot represent a partial or offset-free value. */
export const getCapturedAtComponents = (
  capturedAt: CapturedAt,
): CapturedAtComponents => {
  if (capturedAt.precision === "year") {
    return { year: Number(capturedAt.localDate) };
  }
  if (capturedAt.precision === "month") {
    const [year, month] = capturedAt.localDate.split("-").map(Number) as [
      number,
      number,
    ];
    return { year, month };
  }
  if (capturedAt.precision === "day") {
    const [year, month, day] = capturedAt.localDate.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    return { year, month, day };
  }

  const [year, month, day] = capturedAt.localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const timeParts = capturedAt.localTime.split(":");
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  if (capturedAt.timeResolution === "minute") {
    return { year, month, day, hour, minute };
  }

  const secondPart = timeParts[2] as string;
  const [secondStr, subsecondStr] = secondPart.split(".");
  const second = Number(secondStr);
  if (capturedAt.timeResolution === "second") {
    return { year, month, day, hour, minute, second };
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    subsecondDigits: (subsecondStr as string).padEnd(6, "0"),
  };
};

const UNKNOWN_SEGMENT = "--";
const UNKNOWN_SUBSECOND_SEGMENT = "------";

/**
 * Fixed-width, lexically sortable key encoding capture-local chronology only
 * (never Capture Time Offset). Unknown components use a marker that sorts
 * below every known digit, so a descending scan visits known components
 * before unknown ones at each boundary, and higher known values (newer)
 * before lower ones -- matching Timeline/Archive newest-first order.
 * Store adapters own the surrounding SK; callers never reconstruct this key.
 */
export const buildChronologyKey = (capturedAt: CapturedAt): string => {
  const components = getCapturedAtComponents(capturedAt);
  const year = String(components.year).padStart(4, "0");
  const month =
    components.month !== undefined
      ? String(components.month).padStart(2, "0")
      : UNKNOWN_SEGMENT;
  const day =
    components.day !== undefined
      ? String(components.day).padStart(2, "0")
      : UNKNOWN_SEGMENT;
  const hour =
    components.hour !== undefined
      ? String(components.hour).padStart(2, "0")
      : UNKNOWN_SEGMENT;
  const minute =
    components.minute !== undefined
      ? String(components.minute).padStart(2, "0")
      : UNKNOWN_SEGMENT;
  const second =
    components.second !== undefined
      ? String(components.second).padStart(2, "0")
      : UNKNOWN_SEGMENT;
  const subsecond = components.subsecondDigits ?? UNKNOWN_SUBSECOND_SEGMENT;
  return [year, month, day, hour, minute, second, subsecond].join(".");
};
