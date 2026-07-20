import { getCapturedAtComponents, type CapturedAt, type CapturedAtComponents } from "@album/shared";

export type CapturedAtPreset = "compact" | "accessible" | "detail";

/**
 * One pure formatter for structured Captured At (design doc "Captured At
 * Presentation"). Never constructs a JS `Date` from wall-clock components as
 * an instant to interpret -- it only ever formats in a fixed `timeZone:
 * "UTC"` so the displayed digits always equal the known local components,
 * regardless of the viewer's own time zone, and never invents a missing
 * precision level.
 */
export const formatCapturedAt = (
  capturedAt: CapturedAt,
  preset: CapturedAtPreset,
  locale?: string,
): string => {
  const components = getCapturedAtComponents(capturedAt);
  const epochMs = toUtcEpochMs(components);
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", year: "numeric" };

  if (components.month !== undefined) {
    options.month = preset === "compact" ? "short" : "long";
  }
  if (components.day !== undefined) {
    options.day = "numeric";
  }
  if (components.hour !== undefined) {
    options.hour = "numeric";
    options.minute = "2-digit";
    if (preset === "detail" && components.second !== undefined) {
      options.second = "2-digit";
    }
  }

  let formatted = new Intl.DateTimeFormat(locale, options).format(epochMs);

  if (preset === "detail" && capturedAt.precision === "dateTime" && capturedAt.offset !== undefined) {
    formatted += ` UTC${capturedAt.offset}`;
  }

  return formatted;
};

/** The Photo link's accessible name: File Name plus only genuinely known Captured At components. */
export const photoLinkName = (fileName: string, capturedAt: CapturedAt | undefined): string =>
  capturedAt ? `${fileName}, ${formatCapturedAt(capturedAt, "accessible")}` : fileName;

const toUtcEpochMs = (components: CapturedAtComponents): number =>
  Date.UTC(
    components.year,
    (components.month ?? 1) - 1,
    components.day ?? 1,
    components.hour ?? 0,
    components.minute ?? 0,
    components.second ?? 0,
  );
