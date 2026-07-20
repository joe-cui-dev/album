import type { CapturedAt } from "@album/shared";
import {
  PROCESSING_ISSUES_SUMMARY_SORT_KEY,
  dateIndexPeriodSegment,
  dateIndexSortKey,
  dateIndexYear,
  processingIssueSortKey,
  timelineProjectionSortKey,
} from "./v2-keys.js";

describe("timelineProjectionSortKey", () => {
  it("embeds the collection, chronology key, Added At, and Photo ID", () => {
    const capturedAt: CapturedAt = { precision: "day", localDate: "2024-06-15" };
    expect(
      timelineProjectionSortKey({
        collection: "active",
        capturedAt,
        addedAt: "2026-07-19T00:00:00.000Z",
        photoId: "photo-1",
      }),
    ).toBe("TIMELINE_V2#ACTIVE#2024.06.15.--.--.--.------#2026-07-19T00:00:00.000Z#photo-1");
  });

  it("uses ARCHIVED for the archived collection", () => {
    const capturedAt: CapturedAt = { precision: "year", localDate: "2024" };
    expect(
      timelineProjectionSortKey({
        collection: "archived",
        capturedAt,
        addedAt: "2026-07-19T00:00:00.000Z",
        photoId: "photo-1",
      }),
    ).toBe("TIMELINE_V2#ARCHIVED#2024.--.--.--.--.--.------#2026-07-19T00:00:00.000Z#photo-1");
  });
});

describe("dateIndexSortKey", () => {
  it("pads the year to four digits and includes the collection", () => {
    expect(dateIndexSortKey({ collection: "active", year: 8 })).toBe("DATE_INDEX_V2#ACTIVE#0008");
    expect(dateIndexSortKey({ collection: "archived", year: 2024 })).toBe("DATE_INDEX_V2#ARCHIVED#2024");
  });
});

describe("dateIndexPeriodSegment", () => {
  it("returns a two-digit month when known", () => {
    expect(dateIndexPeriodSegment({ precision: "month", localDate: "2024-06" })).toBe("06");
    expect(dateIndexPeriodSegment({ precision: "day", localDate: "2024-12-25" })).toBe("12");
  });

  it("returns unknown for year precision (Date Unknown)", () => {
    expect(dateIndexPeriodSegment({ precision: "year", localDate: "2024" })).toBe("unknown");
  });
});

describe("dateIndexYear", () => {
  it("extracts the year from any precision", () => {
    expect(dateIndexYear({ precision: "year", localDate: "2024" })).toBe(2024);
    expect(
      dateIndexYear({
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime: "09:00",
        timeResolution: "minute",
      }),
    ).toBe(2024);
  });
});

describe("processingIssueSortKey", () => {
  it("orders by Added At before Photo ID", () => {
    expect(
      processingIssueSortKey({ addedAt: "2026-07-19T00:00:00.000Z", photoId: "photo-1" }),
    ).toBe("PROCESSING_ISSUE#2026-07-19T00:00:00.000Z#photo-1");
  });
});

describe("PROCESSING_ISSUES_SUMMARY_SORT_KEY", () => {
  it("is a fixed singleton key", () => {
    expect(PROCESSING_ISSUES_SUMMARY_SORT_KEY).toBe("PROCESSING_ISSUES#SUMMARY");
  });
});
