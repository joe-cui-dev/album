import { describe, expect, it } from "vitest";
import { computeJustifiedRows, createIncrementalJustifiedRows, type PhotoLayoutDescriptor } from "./justifiedRows.js";

const square = (photoId: string, periodKey: string): PhotoLayoutDescriptor => ({
  photoId,
  periodKey,
  aspectRatio: 1,
});

describe("computeJustifiedRows", () => {
  it("packs a full row exactly to the container width when it fills", () => {
    // 4 square photos at target height 100 need 400px + 3*spacing to fill; containerWidth chosen to match exactly.
    const descriptors = [square("a", "2024-06"), square("b", "2024-06"), square("c", "2024-06"), square("d", "2024-06")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 430,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });

    expect(result.items).toEqual([
      { kind: "month-marker", periodKey: "2024-06" },
      {
        kind: "row",
        periodKey: "2024-06",
        photoIds: ["a", "b", "c", "d"],
        height: 100,
        itemWidths: [100, 100, 100, 100],
      },
    ]);
    expect(result.incompleteTailPhotoIds).toBeUndefined();
  });

  it("never crops or crosses a period boundary, even mid-row", () => {
    const descriptors = [square("a", "2024-06"), square("b", "2024-06"), square("c", "2024-07")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });

    const rows = result.items.filter((item) => item.kind === "row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ periodKey: "2024-06", photoIds: ["a", "b"] });
    expect(rows[1]).toMatchObject({ periodKey: "2024-07", photoIds: ["c"] });
  });

  it("relaxes a non-final period's short tail by justify-filling it, capped at 1.5x target height", () => {
    const descriptors = [square("a", "2024-06"), square("b", "2024-07")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });

    // A lone square photo's natural full-width fill height (1000) exceeds the 150 cap (1.5x100),
    // so it settles at the cap rather than being hard-pulled to fill the entire container width.
    expect(result.items).toEqual([
      { kind: "month-marker", periodKey: "2024-06" },
      { kind: "row", periodKey: "2024-06", photoIds: ["a"], height: 150, itemWidths: [150] },
      { kind: "month-marker", periodKey: "2024-07" },
      { kind: "row", periodKey: "2024-07", photoIds: ["b"], height: 150, itemWidths: [150] },
    ]);
  });

  it("justify-fills a short tail up to the container width when that stays under the 1.5x cap", () => {
    // A lone square photo's natural fill height (containerWidth / aspectRatioSum) is 1000,
    // which is under this test's 1200 cap (1.5x800), so it is not clamped at all.
    const descriptors = [square("a", "2024-06")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 800,
      hasMore: false,
    });

    expect(result.items).toEqual([
      { kind: "month-marker", periodKey: "2024-06" },
      { kind: "row", periodKey: "2024-06", photoIds: ["a"], height: 1000, itemWidths: [1000] },
    ]);
  });

  it("withholds the last period's incomplete tail while more Photos could still arrive", () => {
    const descriptors = [square("a", "2024-06"), square("b", "2024-06")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: true,
    });

    expect(result.items).toEqual([{ kind: "month-marker", periodKey: "2024-06" }]);
    expect(result.incompleteTailPhotoIds).toEqual(["a", "b"]);
  });

  it("relaxes the withheld tail into a visible, justify-filled row once nothing more can arrive", () => {
    const descriptors = [square("a", "2024-06"), square("b", "2024-06")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });

    // Natural fill height ((1000 - 10) / 2 = 495) exceeds the 150 cap, so it settles there.
    expect(result.incompleteTailPhotoIds).toBeUndefined();
    expect(result.items).toEqual([
      { kind: "month-marker", periodKey: "2024-06" },
      { kind: "row", periodKey: "2024-06", photoIds: ["a", "b"], height: 150, itemWidths: [150, 150] },
    ]);
  });

  it("a full row's tail can still be withheld even when an earlier row in the same last period completed", () => {
    const descriptors = [
      square("a", "2024-06"),
      square("b", "2024-06"),
      square("c", "2024-06"),
      square("d", "2024-06"),
      square("e", "2024-06"),
    ];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 430,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: true,
    });

    const rows = result.items.filter((item) => item.kind === "row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ photoIds: ["a", "b", "c", "d"] });
    expect(result.incompleteTailPhotoIds).toEqual(["e"]);
  });

  it("returns no items for an empty descriptor list", () => {
    const result = computeJustifiedRows([], {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });
    expect(result.items).toEqual([]);
    expect(result.incompleteTailPhotoIds).toBeUndefined();
  });

  it("stretches a mixed-aspect-ratio row so total width matches the container exactly", () => {
    const descriptors: PhotoLayoutDescriptor[] = [
      { photoId: "wide", periodKey: "2024-06", aspectRatio: 2 },
      { photoId: "tall", periodKey: "2024-06", aspectRatio: 0.5 },
    ];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 250,
      spacing: 20,
      targetRowHeight: 100,
      hasMore: false,
    });
    const row = result.items.find((item) => item.kind === "row") as Extract<
      (typeof result.items)[number],
      { kind: "row" }
    >;
    const totalWidth = row.itemWidths.reduce((sum, width) => sum + width, 0) + 20 * (row.itemWidths.length - 1);
    expect(totalWidth).toBeCloseTo(250, 5);
  });
});

describe("createIncrementalJustifiedRows", () => {
  const options = { containerWidth: 1000, spacing: 10, targetRowHeight: 200, hasMore: true };

  it("appending page by page matches a single full recompute over the same descriptors", () => {
    const pages: PhotoLayoutDescriptor[][] = [
      [square("a", "2025-03"), square("b", "2025-03")],
      [square("c", "2025-03"), square("d", "2025-02"), square("e", "2025-02")],
      [square("f", "2025-02"), square("g", "2025-01")],
    ];
    const incremental = createIncrementalJustifiedRows();
    let last;
    for (const page of pages) {
      last = incremental.append(page, options);
    }

    const full = computeJustifiedRows(pages.flat(), options);
    expect(last).toEqual(full);
  });

  it("withholds the still-open final group's tail exactly like a full recompute, across appends", () => {
    const incremental = createIncrementalJustifiedRows();
    const afterFirst = incremental.append([square("a", "2025-03")], options);
    expect(afterFirst.incompleteTailPhotoIds).toEqual(["a"]);
    expect(afterFirst.items).toEqual([{ kind: "month-marker", periodKey: "2025-03" }]);

    const afterSecond = incremental.append([square("b", "2025-02")], options);
    const full = computeJustifiedRows([square("a", "2025-03"), square("b", "2025-02")], options);
    expect(afterSecond).toEqual(full);
  });

  it("does not permanently settle a tail relaxed only by a transient load error -- a later same-period append can still extend it", () => {
    const incremental = createIncrementalJustifiedRows();
    incremental.append([square("a", "2025-03")], options);

    // A load error surfaces with no new descriptors; hasMore flips false, relaxing the tail.
    // Natural fill height (1000 / 1 = 1000) exceeds the 300 cap (1.5x200), so it settles there.
    const afterError = incremental.append([], { ...options, hasMore: false });
    expect(afterError.incompleteTailPhotoIds).toBeUndefined();
    expect(afterError.items).toEqual([
      { kind: "month-marker", periodKey: "2025-03" },
      { kind: "row", periodKey: "2025-03", photoIds: ["a"], height: 300, itemWidths: [300] },
    ]);

    // Retry succeeds and extends the same still-open period rather than starting a new one.
    const afterRetry = incremental.append([square("b", "2025-03")], options);
    const full = computeJustifiedRows([square("a", "2025-03"), square("b", "2025-03")], options);
    expect(afterRetry).toEqual(full);
  });

  it("reset recomputes from scratch, e.g. after a container-width change invalidates prior geometry", () => {
    const incremental = createIncrementalJustifiedRows();
    incremental.append([square("a", "2025-03"), square("b", "2025-02")], options);

    const narrower = { ...options, containerWidth: 100 };
    const afterReset = incremental.reset([square("a", "2025-03"), square("b", "2025-02")], narrower);
    const full = computeJustifiedRows([square("a", "2025-03"), square("b", "2025-02")], narrower);
    expect(afterReset).toEqual(full);
  });
});
