import type { Point } from "./viewerTransform.js";

interface GestureOptions {
  viewportWidth(): number;
  isAtFit(): boolean;
  onNext(): void;
  onPrevious(): void;
  onPan(delta: Point): void;
  onPinch(midpoint: Point, distanceRatio: number): void;
  onActiveChange(active: boolean): void;
  onTap(): void;
}

interface ActivePointer { x: number; y: number; time: number }

/** Pointer-event-only gesture state machine shared by mouse, touch, and browser tests. */
export const createViewerGestureController = (options: GestureOptions) => {
  const pointers = new Map<number, ActivePointer>();
  let origin: ActivePointer | undefined;
  let moved = false;
  let pinchDistance: number | undefined;
  let hadMultiplePointers = false;

  const reset = () => {
    pointers.clear(); origin = undefined; moved = false; pinchDistance = undefined; hadMultiplePointers = false; options.onActiveChange(false);
  };
  const pair = (): [ActivePointer, ActivePointer] | undefined => {
    const values = [...pointers.values()];
    return values.length === 2 ? [values[0]!, values[1]!] : undefined;
  };
  const updatePinch = () => {
    const current = pair();
    if (!current) return;
    const [a, b] = current;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance !== undefined && pinchDistance > 0) options.onPinch({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance / pinchDistance);
    pinchDistance = distance;
  };

  return {
    pointerDown(event: PointerEvent) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, time: event.timeStamp });
      if (pointers.size === 1) { origin = pointers.get(event.pointerId); moved = false; options.onActiveChange(true); }
      if (pointers.size === 2) { moved = true; hadMultiplePointers = true; updatePinch(); }
    },
    pointerMove(event: PointerEvent) {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const current = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      pointers.set(event.pointerId, current);
      if (pointers.size === 2) { moved = true; updatePinch(); return; }
      if (!origin) return;
      const delta = { x: current.x - previous.x, y: current.y - previous.y };
      if (Math.hypot(current.x - origin.x, current.y - origin.y) > 8) moved = true;
      if (!options.isAtFit()) options.onPan(delta);
    },
    pointerUp(event: PointerEvent) {
      const current = pointers.get(event.pointerId);
      if (!current || !origin) { reset(); return; }
      pointers.delete(event.pointerId);
      if (pointers.size > 0) return;
      const dx = current.x - origin.x;
      const dy = current.y - origin.y;
      const distance = Math.abs(dx);
      const elapsed = Math.max(1, current.time - origin.time);
      const horizontal = distance > Math.abs(dy);
      const threshold = Math.max(48, options.viewportWidth() * 0.15);
      const commits = options.isAtFit() && horizontal && (distance >= threshold || (distance >= 32 && distance / elapsed >= 0.5));
      if (!hadMultiplePointers && commits) (dx < 0 ? options.onNext : options.onPrevious)();
      else if (!hadMultiplePointers && !moved) options.onTap();
      reset();
    },
    pointerCancel: reset,
    dispose: reset,
  };
};
