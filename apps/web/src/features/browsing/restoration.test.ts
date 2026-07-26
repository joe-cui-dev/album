import { describe, expect, it } from "vitest";
import type { JustifiedLayoutItem } from "./justifiedRows.js";
import { captureAnchor, resolveAnchor } from "./restoration.js";

const row = (periodKey: string, photoIds: string[]): JustifiedLayoutItem => ({
  kind: "row",
  periodKey,
  photoIds,
  height: 200,
  itemWidths: photoIds.map(() => 100),
});

const marker = (periodKey: string): JustifiedLayoutItem => ({ kind: "month-marker", periodKey });

describe("captureAnchor", () => {
  it("captures a photo anchor with its remembered older/newer neighbours", () => {
    const layout = [marker("2024-06"), row("2024-06", ["a", "b"]), row("2024-06", ["c"])];
    const descriptorOrder = ["a", "b", "c"];

    const anchor = captureAnchor(layout, 2, 12, descriptorOrder);

    expect(anchor).toEqual({ kind: "photo", photoId: "c", rowOffset: 12, periodKey: "2024-06", olderPhotoId: undefined, newerPhotoId: "b" });
  });

  it("captures a period anchor when a month marker owns the top position", () => {
    const layout = [marker("2024-06"), row("2024-06", ["a"])];

    expect(captureAnchor(layout, 0, 0, ["a"])).toEqual({ kind: "period", periodKey: "2024-06" });
  });
});

describe("resolveAnchor", () => {
  const layout = [marker("2024-06"), row("2024-06", ["a", "b"]), marker("2024-05"), row("2024-05", ["c"])];

  it("resolves directly to the anchor photo's row when it still exists", () => {
    const resolved = resolveAnchor(layout, { kind: "photo", photoId: "b", rowOffset: 8, periodKey: "2024-06" });

    expect(resolved).toEqual({ itemIndex: 1, rowOffset: 8, kind: "photo", photoId: "b" });
  });

  it("falls back to the older neighbour when the anchor photo is gone", () => {
    const resolved = resolveAnchor(layout, {
      kind: "photo",
      photoId: "missing",
      rowOffset: 8,
      periodKey: "2024-06",
      olderPhotoId: "c",
      newerPhotoId: "also-missing",
    });

    expect(resolved).toEqual({ itemIndex: 3, rowOffset: 8, kind: "photo", photoId: "c" });
  });

  it("falls back to the newer neighbour when the anchor and older neighbour are both gone", () => {
    const resolved = resolveAnchor(layout, {
      kind: "photo",
      photoId: "missing",
      rowOffset: 8,
      periodKey: "2024-06",
      olderPhotoId: "also-missing",
      newerPhotoId: "a",
    });

    expect(resolved).toEqual({ itemIndex: 1, rowOffset: 8, kind: "photo", photoId: "a" });
  });

  it("falls back to the period marker when the photo and both neighbours are gone", () => {
    const resolved = resolveAnchor(layout, {
      kind: "photo",
      photoId: "missing",
      rowOffset: 8,
      periodKey: "2024-05",
      olderPhotoId: "also-missing",
      newerPhotoId: "still-missing",
    });

    expect(resolved).toEqual({ itemIndex: 2, rowOffset: 0, kind: "period", periodKey: "2024-05" });
  });

  it("returns undefined when nothing in the anchor chain resolves", () => {
    const resolved = resolveAnchor(layout, {
      kind: "photo",
      photoId: "missing",
      rowOffset: 8,
      periodKey: "2099-01",
    });

    expect(resolved).toBeUndefined();
  });

  it("resolves a period anchor to its month marker", () => {
    expect(resolveAnchor(layout, { kind: "period", periodKey: "2024-05" })).toEqual({
      itemIndex: 2,
      rowOffset: 0,
      kind: "period",
      periodKey: "2024-05",
    });
  });
});
