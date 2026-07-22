import { describe, expect, it, vi } from "vitest";
import { createViewerGestureController } from "./viewerGesture.js";

const pointer = (overrides: Partial<PointerEvent> = {}): PointerEvent => ({
  pointerId: 1, clientX: 400, clientY: 300, timeStamp: 0, ...overrides,
} as PointerEvent);

describe("viewer gesture controller", () => {
  it("commits a dominant left swipe at Fit", () => {
    const next = vi.fn();
    const controller = createViewerGestureController({ viewportWidth: () => 400, isAtFit: () => true, onNext: next, onPrevious: vi.fn(), onPan: vi.fn(), onPinch: vi.fn(), onActiveChange: vi.fn(), onTap: vi.fn() });
    controller.pointerDown(pointer());
    controller.pointerMove(pointer({ clientX: 320, clientY: 302, timeStamp: 100 }));
    controller.pointerUp(pointer({ clientX: 320, clientY: 302, timeStamp: 100 }));
    expect(next).toHaveBeenCalledOnce();
  });

  it("pans rather than navigates while enlarged and cancels a drag when a second pointer arrives", () => {
    const pan = vi.fn();
    const controller = createViewerGestureController({ viewportWidth: () => 400, isAtFit: () => false, onNext: vi.fn(), onPrevious: vi.fn(), onPan: pan, onPinch: vi.fn(), onActiveChange: vi.fn(), onTap: vi.fn() });
    controller.pointerDown(pointer());
    controller.pointerMove(pointer({ clientX: 340, clientY: 300, timeStamp: 100 }));
    controller.pointerDown(pointer({ pointerId: 2, clientX: 500, clientY: 300 }));
    controller.pointerUp(pointer({ pointerId: 2, clientX: 500, clientY: 300, timeStamp: 120 }));
    controller.pointerUp(pointer({ clientX: 300, clientY: 300, timeStamp: 160 }));
    expect(pan).toHaveBeenCalledWith({ x: -60, y: 0 });
  });

  it("treats short unmodified input as a Photo tap and pointer loss as cancellation", () => {
    const tap = vi.fn();
    const controller = createViewerGestureController({ viewportWidth: () => 400, isAtFit: () => true, onNext: vi.fn(), onPrevious: vi.fn(), onPan: vi.fn(), onPinch: vi.fn(), onActiveChange: vi.fn(), onTap: tap });
    controller.pointerDown(pointer());
    controller.pointerUp(pointer({ timeStamp: 20 }));
    controller.pointerDown(pointer());
    controller.pointerCancel();
    expect(tap).toHaveBeenCalledOnce();
  });
});
