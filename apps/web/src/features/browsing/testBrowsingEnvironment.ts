import type { BrowsingEnvironment } from "./browsingEnvironment.js";

/**
 * A deterministic `BrowsingEnvironment` for tests: manual clock, one-shot timers advanced
 * explicitly, and manual online/visibility toggles. Lets deep-module tests express every race
 * (generation fencing, backoff, suspension) without real timers, `Date.now`, `window`, or `document`.
 */
export interface TestBrowsingEnvironment {
  environment: BrowsingEnvironment;
  setNow(ms: number): void;
  /** Advances the clock to `ms` and fires every timer now due, in deadline order. */
  advanceTo(ms: number): void;
  advanceBy(ms: number): void;
  pendingTimerCount(): number;
  nextDeadline(): number | undefined;
  setOnline(online: boolean): void;
  setVisible(visible: boolean): void;
}

export const createTestBrowsingEnvironment = (initialNowMs = 0): TestBrowsingEnvironment => {
  let nowMs = initialNowMs;
  let online = true;
  let visible = true;
  let nextTimerId = 0;
  const timers = new Map<number, { deadlineMs: number; callback: () => void }>();
  const onlineListeners = new Set<(online: boolean) => void>();
  const visibleListeners = new Set<(visible: boolean) => void>();

  const fireDue = (): void => {
    for (;;) {
      let dueId: number | undefined;
      let dueDeadline = Infinity;
      for (const [id, timer] of timers) {
        if (timer.deadlineMs <= nowMs && timer.deadlineMs < dueDeadline) {
          dueDeadline = timer.deadlineMs;
          dueId = id;
        }
      }
      if (dueId === undefined) {
        return;
      }
      const timer = timers.get(dueId)!;
      timers.delete(dueId);
      timer.callback();
    }
  };

  return {
    environment: {
      now: () => nowMs,
      scheduleAt: (deadlineMs, callback) => {
        const id = nextTimerId++;
        timers.set(id, { deadlineMs, callback });
        return () => timers.delete(id);
      },
      isOnline: () => online,
      onOnlineChange: (listener) => {
        onlineListeners.add(listener);
        return () => onlineListeners.delete(listener);
      },
      isVisible: () => visible,
      onVisibleChange: (listener) => {
        visibleListeners.add(listener);
        return () => visibleListeners.delete(listener);
      },
    },
    setNow: (ms) => {
      nowMs = ms;
    },
    advanceTo: (ms) => {
      nowMs = ms;
      fireDue();
    },
    advanceBy: (ms) => {
      nowMs += ms;
      fireDue();
    },
    pendingTimerCount: () => timers.size,
    nextDeadline: () => (timers.size === 0 ? undefined : Math.min(...[...timers.values()].map((timer) => timer.deadlineMs))),
    setOnline: (next) => {
      if (next === online) {
        return;
      }
      online = next;
      for (const listener of onlineListeners) {
        listener(next);
      }
    },
    setVisible: (next) => {
      if (next === visible) {
        return;
      }
      visible = next;
      for (const listener of visibleListeners) {
        listener(next);
      }
    },
  };
};
