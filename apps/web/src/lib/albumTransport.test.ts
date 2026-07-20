import { afterEach, describe, expect, it, vi } from "vitest";
import { AlbumTransportError, albumTransport } from "./albumTransport.js";
import { sessionExpiredEvent } from "./sessionEvents.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("albumTransport.request", () => {
  it("returns the parsed body on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ ok: true }));

    await expect(albumTransport.request("/v2/timeline")).resolves.toEqual({ ok: true });
  });

  it("classifies an aborted fetch as cancelled", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("classifies a fetch rejection as network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "network",
    });
  });

  it("classifies a non-JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "non_json",
    });
  });

  it("dispatches the session-expired event and throws auth_lost on a 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ message: "nope" }, { status: 401 }));
    const listener = vi.fn();
    window.addEventListener(sessionExpiredEvent, listener);

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "auth_lost",
      status: 401,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(sessionExpiredEvent, listener);
  });

  it("carries a stable server error code through as a typed error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ code: "empty_period", message: "This period is now empty." }, { status: 409 }),
    );

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "empty_period",
      status: 409,
    });
  });

  it("carries currentCollection through for a photo_collection_changed conflict", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(
        { code: "photo_collection_changed", message: "moved", currentCollection: "archived" },
        { status: 409 },
      ),
    );

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "photo_collection_changed",
      currentCollection: "archived",
    });
  });

  it("falls back to an unexpected code for an unrecognised error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ message: "boom" }, { status: 500 }));

    await expect(albumTransport.request("/v2/timeline")).rejects.toMatchObject({
      code: "unexpected",
      status: 500,
    });
  });

  it("throws an instance of AlbumTransportError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ message: "boom" }, { status: 500 }));

    await expect(albumTransport.request("/v2/timeline")).rejects.toBeInstanceOf(AlbumTransportError);
  });
});
