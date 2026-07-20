import { fireEvent, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { sessionExpiredEvent } from "./lib/sessionEvents.js";
import { renderApp } from "./test/test-utils.js";

const apiBaseUrl =
  "https://replace-with-http-api-id.execute-api.ap-southeast-2.amazonaws.com";

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("shows the email sign-in form when no session is active", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ signedIn: false }),
    );

    renderApp(<App />);

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send sign-in code" }),
    ).toBeInTheDocument();
  });

  it("gives an empty signed-in album a single clear next action that links to Add Photos", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);

    expect(await screen.findByRole("navigation", { name: "Album" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your album is empty" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("heading", { name: "Your album is empty" }).parentElement!)
        .getByRole("link", { name: "Add photos" }),
    ).toHaveAttribute("href", "/album/upload");
  });

  it("keeps Archive behind the signed-in application route", async () => {
    window.history.replaceState({}, "", "/album/archive");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);

    expect(
      await screen.findByRole("heading", { name: "Your archive is empty" }),
    ).toBeInTheDocument();
  });

  it("navigates from the shell's Add Photos link to the Manual Upload workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);
    const nav = await screen.findByRole("navigation", { name: "Album" });
    await userEvent.click(within(nav).getByRole("link", { name: "Add photos" }));

    expect(await screen.findByLabelText("Choose photos")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add photos" })).toBeInTheDocument();
  });

  it("returns to sign-in when a protected request reports an expired session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);
    await screen.findByRole("navigation", { name: "Album" });

    fireEvent(window, new Event(sessionExpiredEvent));

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
  });

  it("shows an actionable error when the API responds with the Vite HTML fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<!doctype html><html></html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );

    renderApp(<App />);

    expect(
      await screen.findByText(
        "API returned HTML instead of JSON. Set VITE_API_BASE_URL to the Phase 5 HTTP API URL before starting Vite.",
      ),
    ).toBeInTheDocument();
  });

  it("requests a sign-in code on the same page and shows a development code hint", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ signedIn: false }))
      .mockResolvedValueOnce(
        Response.json({ accepted: true, codeId: "code-1", devCode: "123456" }),
      );

    renderApp(<App />);

    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "joe@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
    expect(screen.getByText(/Development code:/)).toHaveTextContent("123456");
    expect(fetch).toHaveBeenLastCalledWith(
      `${apiBaseUrl}/session/sign-in-code`,
      {
        method: "POST",
        body: JSON.stringify({ email: "joe@example.com" }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  it("signs out, returns to the email sign-in form, and resets the URL to the generic entry route", async () => {
    window.history.replaceState({}, "", "/album/archive");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ signedIn: false }));

    renderApp(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(`${apiBaseUrl}/session`, {
      method: "DELETE",
      credentials: "include",
      headers: {},
    });
    expect(window.location.pathname).toBe("/");
  });

  it("browses timeline photos, opens detail, archives, and creates a single-photo original download", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          photos: [
            {
              photoId: "photo-1",
              fileName: "beach.jpg",
              capturedAt: "2025-01-02T10:00:00.000Z",
              processingState: "ready",
              archived: false,
              displayDimensions: { width: 1600, height: 1200 },
              timelineThumbnailUrl: "https://temporary.example/thumbnail.jpg",
              timelineThumbnailDimensions: { width: 320, height: 240 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          photoId: "photo-1",
          fileName: "beach.jpg",
          format: "jpeg",
          fileSizeBytes: 1234,
          capturedAt: "2025-01-02T10:00:00.000Z",
          capturedAtSource: "exif",
          processingState: "ready",
          archived: false,
          metadata: {
            width: 4000,
            height: 3000,
            cameraMake: "Canon",
          },
          displayDimensions: { width: 1600, height: 1200 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          url: "https://temporary.example/display.jpg",
          expiresInSeconds: 300,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          url: "https://temporary.example/original.jpg",
          expiresInSeconds: 300,
        }),
      )
      .mockResolvedValueOnce(Response.json({ photoId: "photo-1", archived: true }))
      .mockResolvedValueOnce(Response.json({ photos: [] }));

    renderApp(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Refresh timeline" }));
    expect(await screen.findByAltText("beach.jpg thumbnail")).toHaveAttribute(
      "src",
      "https://temporary.example/thumbnail.jpg",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Open beach.jpg" }));

    expect(await screen.findByText("Canon")).toBeInTheDocument();
    expect(screen.getByAltText("beach.jpg")).toHaveAttribute(
      "src",
      "https://temporary.example/display.jpg",
    );

    await userEvent.click(screen.getByRole("button", { name: "Download original" }));
    expect(await screen.findByRole("link", { name: "Open original download" })).toHaveAttribute(
      "href",
      "https://temporary.example/original.jpg",
    );

    await userEvent.click(screen.getByRole("button", { name: "Archive photo" }));
    expect(await screen.findByRole("heading", { name: "Your album is empty" })).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(2, `${apiBaseUrl}/timeline`, {
      credentials: "include",
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(4, `${apiBaseUrl}/photos/photo-1/display-access`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(5, `${apiBaseUrl}/photos/photo-1/original-download`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(6, `${apiBaseUrl}/photos/photo-1/archive`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });
  });
});
