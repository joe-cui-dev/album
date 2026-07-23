import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

/**
 * Failure-matrix scaffolding for the "race/environment" family (execution plan Slice 0.3):
 * offline/online transitions and visibility changes, for specs that assert recovery-loop
 * behaviour (access renewal backoff, one-Display-refresh-then-Retry, and similar).
 */
export const goOffline = (page: Page): Promise<void> => page.context().setOffline(true);

export const goOnline = (page: Page): Promise<void> => page.context().setOffline(false);

/** Dispatches a real `visibilitychange` by toggling `document.hidden` via CDP-less document override. */
export const setDocumentVisibility = (page: Page, hidden: boolean): Promise<void> =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isHidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

/**
 * Issues a raw mutation request with an explicit `Origin` header, bypassing `AlbumApiMock`'s
 * page-level route interception. Scaffolding for Slice 1's exact-Origin guard, which has no
 * production implementation yet -- callers must point `request` at a real API deployment.
 */
export const probeWithOrigin = (
  request: APIRequestContext,
  url: string,
  origin: string | undefined,
  init: { method: "POST" | "PUT" | "PATCH" | "DELETE"; data?: unknown } = { method: "POST" },
): Promise<APIResponse> =>
  request.fetch(url, {
    method: init.method,
    data: init.data,
    headers: origin === undefined ? {} : { Origin: origin },
  });
