import type { CapturedAt } from "@album/shared";
import {
  PROCESSING_ISSUES_SUMMARY_SORT_KEY,
  dateIndexPeriodSegment,
  dateIndexPrefix,
  dateIndexSortKey,
  dateIndexYear,
  omitZeroCounts,
  parseStartAt,
  processingIssueSortKey,
  timelinePeriodUpperBoundSortKey,
  timelineProjectionPrefix,
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

describe("timelineProjectionPrefix / dateIndexPrefix", () => {
  it("matches the prefix embedded in the full sort keys", () => {
    expect(timelineProjectionPrefix("active")).toBe("TIMELINE_V2#ACTIVE#");
    expect(timelineProjectionPrefix("archived")).toBe("TIMELINE_V2#ARCHIVED#");
    expect(dateIndexPrefix("active")).toBe("DATE_INDEX_V2#ACTIVE#");
    expect(dateIndexPrefix("archived")).toBe("DATE_INDEX_V2#ARCHIVED#");
  });
});

describe("parseStartAt", () => {
  it.each([
    ["2024-06", { year: 2024, month: 6 }],
    ["2024-unknown", { year: 2024 }],
    ["0008-01", { year: 8, month: 1 }],
  ] as const)("parses %s", (value, expected) => {
    expect(parseStartAt(value)).toEqual(expected);
  });

  it.each(["2024-13", "2024-00", "2024", "2024-6", "not-a-period", "2024-unknow"])(
    "rejects %s",
    (value) => {
      expect(parseStartAt(value)).toBeUndefined();
    },
  );
});

describe("timelinePeriodUpperBoundSortKey", () => {
  it("sorts above every real projection in the target month, at or below the collection prefix", () => {
    const bound = timelinePeriodUpperBoundSortKey("active", { year: 2024, month: 6 });
    const lastDayOfMonth = timelineProjectionSortKey({
      collection: "active",
      capturedAt: { precision: "day", localDate: "2024-06-30" },
      addedAt: "2026-07-19T00:00:00.000Z",
      photoId: "photo-1",
    });
    const nextMonth = timelineProjectionSortKey({
      collection: "active",
      capturedAt: { precision: "month", localDate: "2024-07" },
      addedAt: "2026-07-19T00:00:00.000Z",
      photoId: "photo-1",
    });
    expect(lastDayOfMonth < bound).toBe(true);
    expect(bound < nextMonth).toBe(true);
  });

  it("anchors the year's Date Unknown group below every known month", () => {
    const bound = timelinePeriodUpperBoundSortKey("active", { year: 2024 });
    const yearOnly = timelineProjectionSortKey({
      collection: "active",
      capturedAt: { precision: "year", localDate: "2024" },
      addedAt: "2026-07-19T00:00:00.000Z",
      photoId: "photo-1",
    });
    const january = timelineProjectionSortKey({
      collection: "active",
      capturedAt: { precision: "month", localDate: "2024-01" },
      addedAt: "2026-07-19T00:00:00.000Z",
      photoId: "photo-1",
    });
    expect(yearOnly < bound).toBe(true);
    expect(bound < january).toBe(true);
  });
});

describe("omitZeroCounts", () => {
  it("drops zero-valued periods while keeping nonzero ones, even in a mixed year", () => {
    expect(omitZeroCounts({ "06": 2, "07": 0, unknown: 1 })).toEqual({ "06": 2, unknown: 1 });
  });

  it("returns an empty object for an all-zero year", () => {
    expect(omitZeroCounts({ "06": 0, "07": 0 })).toEqual({});
  });
});
