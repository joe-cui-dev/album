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

  it("relaxes a non-final period's short tail into a final row at target height", () => {
    const descriptors = [square("a", "2024-06"), square("b", "2024-07")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });

    expect(result.items).toEqual([
      { kind: "month-marker", periodKey: "2024-06" },
      { kind: "row", periodKey: "2024-06", photoIds: ["a"], height: 100, itemWidths: [100] },
      { kind: "month-marker", periodKey: "2024-07" },
      { kind: "row", periodKey: "2024-07", photoIds: ["b"], height: 100, itemWidths: [100] },
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

  it("relaxes the withheld tail into a visible row once nothing more can arrive", () => {
    const descriptors = [square("a", "2024-06"), square("b", "2024-06")];
    const result = computeJustifiedRows(descriptors, {
      containerWidth: 1000,
      spacing: 10,
      targetRowHeight: 100,
      hasMore: false,
    });

    expect(result.incompleteTailPhotoIds).toBeUndefined();
    expect(result.items).toEqual([
      { kind: "month-marker", periodKey: "2024-06" },
      { kind: "row", periodKey: "2024-06", photoIds: ["a", "b"], height: 100, itemWidths: [100, 100] },
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
    const afterError = incremental.append([], { ...options, hasMore: false });
    expect(afterError.incompleteTailPhotoIds).toBeUndefined();
    expect(afterError.items).toEqual([
      { kind: "month-marker", periodKey: "2025-03" },
      { kind: "row", periodKey: "2025-03", photoIds: ["a"], height: 200, itemWidths: [200] },
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
