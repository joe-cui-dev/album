import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no real layout engine, so it can never report a genuine measured width. The Browsing
// Window now waits for a real viewport observation before starting any network work, so the stub
// reports one fixed, usable width synchronously on `observe()` -- otherwise every test relying on
// the grid would hang forever waiting for a resize that jsdom can't produce.
class ResizeObserverStub {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(): void {
    this.#callback(
      [{ contentRect: { width: 1000, height: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom only stubs window.scrollTo with a warning; the virtualizer's restoration calls it directly.
window.scrollTo = (() => {}) as typeof window.scrollTo;

afterEach(() => {
  cleanup();
});
