import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement ResizeObserver; the virtualized Browsing Grid only needs the constructor to exist.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom only stubs window.scrollTo with a warning; the virtualizer's restoration calls it directly.
window.scrollTo = (() => {}) as typeof window.scrollTo;

afterEach(() => {
  cleanup();
});
