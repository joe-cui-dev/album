import { describe, expect, it } from "vitest";
import { constrainPan, createViewerTransform, fitScale, resetForPhoto, resizeTransform, scaleAroundPoint } from "./viewerTransform.js";

describe("viewer transform", () => {
  const photo = { width: 1600, height: 1200 };
  const viewport = { width: 800, height: 800 };

  it("fits the complete Photo and never magnifies past intrinsic pixels", () => {
    expect(fitScale(photo, viewport)).toBe(0.5);
    expect(fitScale({ width: 400, height: 300 }, viewport)).toBe(1);
  });

  it("keeps the focal Photo point under the same viewport point while scaling", () => {
    const initial = createViewerTransform(photo, viewport);
    const scaled = scaleAroundPoint(initial, 1, { x: 600, y: 400 });

    expect(scaled.scale).toBe(1);
    expect(scaled.pan.x).toBe(-200);
    expect(scaled.pan.y).toBe(0);
  });

  it("clamps pan independently and centres an axis smaller than the viewport", () => {
    const initial = createViewerTransform({ width: 1600, height: 400 }, viewport);
    const enlarged = scaleAroundPoint(initial, 1, { x: 400, y: 400 });
    expect(enlarged.pan).toEqual({ x: 0, y: 0 });
    expect(constrainPan(enlarged, { x: 900, y: -900 })).toEqual({ x: 400, y: 0 });
  });

  it("preserves intrinsic scale and centre focal point across a resize", () => {
    const initial = scaleAroundPoint(createViewerTransform(photo, viewport), 1, { x: 600, y: 400 });
    const resized = resizeTransform(initial, { width: 1000, height: 600 });

    expect(resized.scale).toBe(1);
    expect(resized.viewport).toEqual({ width: 1000, height: 600 });
    expect(resized.pan).toEqual({ x: -200, y: 0 });
  });

  it("resets a new Photo to Fit", () => {
    const enlarged = scaleAroundPoint(createViewerTransform(photo, viewport), 1, { x: 600, y: 400 });
    expect(resetForPhoto(enlarged, { width: 600, height: 1200 })).toMatchObject({ scale: 2 / 3, pan: { x: 0, y: 0 } });
  });
});
