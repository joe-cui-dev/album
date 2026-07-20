import {
  buildChronologyKey,
  getCapturedAtComponents,
  isCapturedAt,
  isSameCapturedAt,
  validateCapturedAt,
  type CapturedAt,
} from "./chronology.js";

const valid = (value: CapturedAt) => expect(validateCapturedAt(value)).toEqual([]);
const invalid = (value: unknown, pathContains?: string) => {
  const errors = validateCapturedAt(value);
  expect(errors.length).toBeGreaterThan(0);
  if (pathContains !== undefined) {
    expect(errors.some((e) => e.path === pathContains)).toBe(true);
  }
};

describe("validateCapturedAt: precisions", () => {
  it("accepts a valid year value", () => {
    valid({ precision: "year", localDate: "2024" });
  });

  it("accepts a valid month value", () => {
    valid({ precision: "month", localDate: "2024-02" });
  });

  it("accepts a valid day value", () => {
    valid({ precision: "day", localDate: "2024-02-29" });
  });

  it.each<{ timeResolution: "minute" | "second" | "subsecond"; localTime: string }>([
    { timeResolution: "minute", localTime: "14:05" },
    { timeResolution: "second", localTime: "14:05:09" },
    { timeResolution: "subsecond", localTime: "14:05:09.123" },
    { timeResolution: "subsecond", localTime: "14:05:09.1" },
    { timeResolution: "subsecond", localTime: "14:05:09.123456" },
  ])("accepts a valid dateTime value at $timeResolution resolution", ({ timeResolution, localTime }) => {
    valid({
      precision: "dateTime",
      localDate: "2024-02-29",
      localTime,
      timeResolution,
    });
  });

  it("accepts dateTime with a canonical positive offset", () => {
    valid({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:00:00",
      timeResolution: "second",
      offset: "+10:00",
    });
  });

  it("accepts dateTime with no offset", () => {
    valid({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:00",
      timeResolution: "minute",
    });
  });

  it.each(["year", "month", "day"] as const)(
    "rejects localTime/timeResolution/offset on a %s value",
    (precision) => {
      invalid({ precision, localDate: "2024", localTime: "09:00" }, "localTime");
      invalid(
        { precision, localDate: "2024", timeResolution: "minute" },
        "timeResolution",
      );
      invalid({ precision, localDate: "2024", offset: "+00:00" }, "offset");
    },
  );

  it("rejects an unexpected extra property", () => {
    invalid({ precision: "year", localDate: "2024", extra: true }, "extra");
  });

  it("rejects an unknown precision", () => {
    invalid({ precision: "decade", localDate: "2024" }, "precision");
  });

  it("rejects a non-object value", () => {
    invalid(null);
    invalid("2024");
    invalid(undefined);
  });
});

describe("validateCapturedAt: year bounds", () => {
  it.each(["0001", "9999", "2024"])("accepts year %s", (localDate) => {
    valid({ precision: "year", localDate });
  });

  it.each(["0000", "00012", "202", "abcd", "-001"])(
    "rejects year %s",
    (localDate) => {
      invalid({ precision: "year", localDate }, "localDate");
    },
  );
});

describe("validateCapturedAt: leap years", () => {
  it.each(["2024-02-29", "2000-02-29"])(
    "accepts leap day %s",
    (localDate) => {
      valid({ precision: "day", localDate });
    },
  );

  it.each(["2023-02-29", "1900-02-29"])(
    "rejects non-leap-year day %s",
    (localDate) => {
      invalid({ precision: "day", localDate }, "localDate");
    },
  );
});

describe("validateCapturedAt: invalid calendar data", () => {
  it.each(["2024-00-01", "2024-13-01"])("rejects month out of range %s", (localDate) => {
    invalid({ precision: "day", localDate }, "localDate");
  });

  it.each(["2024-04-31", "2024-02-30", "2024-01-32", "2024-01-00"])(
    "rejects day out of range %s without automatic rollover",
    (localDate) => {
      invalid({ precision: "day", localDate }, "localDate");
    },
  );
});

describe("validateCapturedAt: invalid time", () => {
  it.each([
    { timeResolution: "minute" as const, localTime: "24:00" },
    { timeResolution: "minute" as const, localTime: "12:60" },
    { timeResolution: "second" as const, localTime: "12:30:60" },
    { timeResolution: "minute" as const, localTime: "9:00" },
    { timeResolution: "second" as const, localTime: "12:30" },
    { timeResolution: "subsecond" as const, localTime: "12:30:00" },
    { timeResolution: "subsecond" as const, localTime: "12:30:00.1234567" },
  ])("rejects $localTime at $timeResolution resolution", ({ timeResolution, localTime }) => {
    invalid(
      {
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime,
        timeResolution,
      },
      "localTime",
    );
  });
});

describe("validateCapturedAt: canonical subsecond representation", () => {
  it.each(["09:00:00.1", "09:00:00.0", "09:00:00.123456", "09:00:00.000001"])(
    "accepts canonical subsecond time %s",
    (localTime) => {
      valid({
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime,
        timeResolution: "subsecond",
      });
    },
  );

  it.each(["09:00:00.10", "09:00:00.00", "09:00:00.120", "09:00:00.100000"])(
    "rejects a non-canonical (trailing-zero) subsecond time %s",
    (localTime) => {
      invalid(
        {
          precision: "dateTime",
          localDate: "2024-06-15",
          localTime,
          timeResolution: "subsecond",
        },
        "localTime",
      );
    },
  );
});

describe("validateCapturedAt: invalid/canonical offsets", () => {
  it.each(["+00:00", "-05:30", "+10:00", "+14:00", "-12:00"])(
    "accepts canonical offset %s",
    (offset) => {
      valid({
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime: "09:00",
        timeResolution: "minute",
        offset,
      });
    },
  );

  it.each(["-00:00", "+14:01", "-12:01", "Z", "+1000", "+10:0", "10:00", "+25:00"])(
    "rejects non-canonical or out-of-range offset %s",
    (offset) => {
      invalid(
        {
          precision: "dateTime",
          localDate: "2024-06-15",
          localTime: "09:00",
          timeResolution: "minute",
          offset,
        },
        "offset",
      );
    },
  );
});

describe("isCapturedAt", () => {
  it("mirrors validateCapturedAt", () => {
    expect(isCapturedAt({ precision: "year", localDate: "2024" })).toBe(true);
    expect(isCapturedAt({ precision: "year", localDate: "0000" })).toBe(false);
  });
});

describe("getCapturedAtComponents", () => {
  it("extracts only the known components at each precision", () => {
    expect(getCapturedAtComponents({ precision: "year", localDate: "2024" })).toEqual({
      year: 2024,
    });
    expect(
      getCapturedAtComponents({ precision: "month", localDate: "2024-06" }),
    ).toEqual({ year: 2024, month: 6 });
    expect(
      getCapturedAtComponents({ precision: "day", localDate: "2024-06-15" }),
    ).toEqual({ year: 2024, month: 6, day: 15 });
    expect(
      getCapturedAtComponents({
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime: "09:30",
        timeResolution: "minute",
      }),
    ).toEqual({ year: 2024, month: 6, day: 15, hour: 9, minute: 30 });
    expect(
      getCapturedAtComponents({
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime: "09:30:45",
        timeResolution: "second",
      }),
    ).toEqual({ year: 2024, month: 6, day: 15, hour: 9, minute: 30, second: 45 });
    expect(
      getCapturedAtComponents({
        precision: "dateTime",
        localDate: "2024-06-15",
        localTime: "09:30:45.12",
        timeResolution: "subsecond",
      }),
    ).toEqual({
      year: 2024,
      month: 6,
      day: 15,
      hour: 9,
      minute: 30,
      second: 45,
      subsecondDigits: "120000",
    });
  });
});

describe("isSameCapturedAt", () => {
  it("treats identical values as the same", () => {
    expect(
      isSameCapturedAt(
        { precision: "year", localDate: "2024" },
        { precision: "year", localDate: "2024" },
      ),
    ).toBe(true);
    expect(
      isSameCapturedAt(
        {
          precision: "dateTime",
          localDate: "2024-06-15",
          localTime: "09:00:00",
          timeResolution: "second",
          offset: "+10:00",
        },
        {
          precision: "dateTime",
          localDate: "2024-06-15",
          localTime: "09:00:00",
          timeResolution: "second",
          offset: "+10:00",
        },
      ),
    ).toBe(true);
  });

  it("treats different precisions or components as different", () => {
    expect(
      isSameCapturedAt(
        { precision: "year", localDate: "2024" },
        { precision: "month", localDate: "2024-01" },
      ),
    ).toBe(false);
    expect(
      isSameCapturedAt(
        { precision: "day", localDate: "2024-06-15" },
        { precision: "day", localDate: "2024-06-16" },
      ),
    ).toBe(false);
  });

  it("treats a differing offset as different even though it never affects ordering", () => {
    const withOffset: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:00",
      timeResolution: "minute",
      offset: "+10:00",
    };
    const withoutOffset: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:00",
      timeResolution: "minute",
    };
    expect(isSameCapturedAt(withOffset, withoutOffset)).toBe(false);
  });
});

describe("buildChronologyKey: fixed width", () => {
  it("always returns the same length regardless of known/unknown segments", () => {
    const yearOnly = buildChronologyKey({ precision: "year", localDate: "2024" });
    const full = buildChronologyKey({
      precision: "dateTime",
      localDate: "2024-06-15",
      localTime: "09:30:45.123",
      timeResolution: "subsecond",
    });
    expect(yearOnly.length).toBe(full.length);
  });
});

describe("buildChronologyKey: recursive unknown-component ordering", () => {
  const keyOf = (value: CapturedAt) => buildChronologyKey(value);
  const descendingSorted = (values: CapturedAt[]) =>
    [...values].sort((a, b) => (keyOf(a) < keyOf(b) ? 1 : keyOf(a) > keyOf(b) ? -1 : 0));

  it("orders known months newest first, then Date Unknown (year-only) last", () => {
    const december: CapturedAt = { precision: "month", localDate: "2024-12" };
    const january: CapturedAt = { precision: "month", localDate: "2024-01" };
    const yearOnly: CapturedAt = { precision: "year", localDate: "2024" };
    expect(descendingSorted([yearOnly, january, december])).toEqual([
      december,
      january,
      yearOnly,
    ]);
  });

  it("orders known days newest first, then month-only (Date Unknown day) last", () => {
    const day31: CapturedAt = { precision: "day", localDate: "2024-01-31" };
    const day01: CapturedAt = { precision: "day", localDate: "2024-01-01" };
    const monthOnly: CapturedAt = { precision: "month", localDate: "2024-01" };
    expect(descendingSorted([monthOnly, day01, day31])).toEqual([day31, day01, monthOnly]);
  });

  it("orders known times before day-only on the same day", () => {
    const withTime: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:00",
      timeResolution: "minute",
    };
    const dayOnly: CapturedAt = { precision: "day", localDate: "2024-01-15" };
    expect(descendingSorted([dayOnly, withTime])).toEqual([withTime, dayOnly]);
  });

  it("orders known seconds before minute-only within the same minute", () => {
    const withSecond: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:30:15",
      timeResolution: "second",
    };
    const minuteOnly: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:30",
      timeResolution: "minute",
    };
    expect(descendingSorted([minuteOnly, withSecond])).toEqual([withSecond, minuteOnly]);
  });

  it("orders known subseconds before second-only within the same second", () => {
    const withSubsecond: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:30:15.500",
      timeResolution: "subsecond",
    };
    const secondOnly: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:30:15",
      timeResolution: "second",
    };
    expect(descendingSorted([secondOnly, withSubsecond])).toEqual([
      withSubsecond,
      secondOnly,
    ]);
  });

  it("orders higher known times as newer within the same day", () => {
    const evening: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "20:00",
      timeResolution: "minute",
    };
    const morning: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:00",
      timeResolution: "minute",
    };
    expect(descendingSorted([morning, evening])).toEqual([evening, morning]);
  });

  it("ignores Capture Time Offset when ordering", () => {
    const plusOffset: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:00",
      timeResolution: "minute",
      offset: "+10:00",
    };
    const noOffset: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-01-15",
      localTime: "08:00",
      timeResolution: "minute",
    };
    expect(keyOf(plusOffset)).toBe(keyOf(noOffset));
  });

  it("produces one consistent global order across a mixed list spanning every precision boundary", () => {
    const subsecondKnown: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-03-10",
      localTime: "08:00:00.5",
      timeResolution: "subsecond",
    };
    const secondOnly: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-03-10",
      localTime: "08:00:00",
      timeResolution: "second",
    };
    const minuteOnly: CapturedAt = {
      precision: "dateTime",
      localDate: "2024-03-10",
      localTime: "08:00",
      timeResolution: "minute",
    };
    const dayOnly: CapturedAt = { precision: "day", localDate: "2024-03-10" };
    const monthOnly: CapturedAt = { precision: "month", localDate: "2024-03" };
    const yearOnly: CapturedAt = { precision: "year", localDate: "2024" };

    const shuffled = [
      monthOnly,
      subsecondKnown,
      yearOnly,
      minuteOnly,
      dayOnly,
      secondOnly,
    ];
    expect(descendingSorted(shuffled)).toEqual([
      subsecondKnown,
      secondOnly,
      minuteOnly,
      dayOnly,
      monthOnly,
      yearOnly,
    ]);
  });

  it("orders newer years above older years regardless of finer precision", () => {
    const olderWithFullTime: CapturedAt = {
      precision: "dateTime",
      localDate: "2023-12-31",
      localTime: "23:59:59",
      timeResolution: "second",
    };
    const newerYearOnly: CapturedAt = { precision: "year", localDate: "2024" };
    expect(descendingSorted([olderWithFullTime, newerYearOnly])).toEqual([
      newerYearOnly,
      olderWithFullTime,
    ]);
  });
});
