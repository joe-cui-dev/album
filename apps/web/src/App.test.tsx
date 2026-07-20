import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlbumNavigationResponse, ListCollectionPhotosV2Response, ViewerBootstrapResponse } from "@album/shared";
import { App } from "./App.js";
import { sessionExpiredEvent } from "./lib/sessionEvents.js";
import { renderApp } from "./test/test-utils.js";

const apiBaseUrl =
  "https://replace-with-http-api-id.execute-api.ap-southeast-2.amazonaws.com";

const session = { signedIn: true, user: { userId: "user-1", email: "joe@example.com" } };

const emptyNavigation: AlbumNavigationResponse = {
  timeline: { years: [] },
  archive: { years: [] },
  processingIssueCount: 0,
};

const emptyCollectionPage: ListCollectionPhotosV2Response = { photos: [] };

const onePhotoCollectionPage: ListCollectionPhotosV2Response = {
  photos: [
    {
      photoId: "photo-1",
      fileName: "beach.jpg",
      capturedAt: { precision: "day", localDate: "2025-01-02" },
      addedAt: "2025-01-02T10:00:00.000Z",
      displayDimensions: { width: 1600, height: 1200 },
      timelineThumbnailSources: {
        large: { url: "https://temporary.example/thumbnail.jpg", dimensions: { width: 640, height: 480 } },
      },
    },
  ],
  // Far enough in the future that the Grid's mount-time renewal check is a no-op.
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const viewerBootstrap: ViewerBootstrapResponse = {
  photoId: "photo-1",
  fileName: "beach.jpg",
  format: "jpeg",
  fileSizeBytes: 1234,
  metadata: { cameraMake: "Canon" },
  displayDimensions: { width: 1600, height: 1200 },
  chronology: {
    original: { capturedAt: { precision: "day", localDate: "2025-01-02" }, source: "exif" },
    active: { capturedAt: { precision: "day", localDate: "2025-01-02" }, source: "exif", revision: 1 },
  },
  archived: false,
  collection: "active",
  displayAccess: { url: "https://temporary.example/display.jpg", expiresAt: "2099-01-01T00:00:00.000Z" },
};

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
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(emptyCollectionPage))
      .mockResolvedValueOnce(Response.json(emptyNavigation));

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
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(emptyCollectionPage))
      .mockResolvedValueOnce(Response.json(emptyNavigation));

    renderApp(<App />);

    expect(
      await screen.findByRole("heading", { name: "Your archive is empty" }),
    ).toBeInTheDocument();
  });

  it("navigates from the shell's Add Photos link to the Manual Upload workspace", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(emptyCollectionPage))
      .mockResolvedValueOnce(Response.json(emptyNavigation));

    renderApp(<App />);
    const nav = await screen.findByRole("navigation", { name: "Album" });
    await userEvent.click(within(nav).getByRole("link", { name: "Add photos" }));

    expect(await screen.findByLabelText("Choose photos")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add photos" })).toBeInTheDocument();
  });

  it("returns to sign-in when a protected request reports an expired session", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(emptyCollectionPage))
      .mockResolvedValueOnce(Response.json(emptyNavigation));

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
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(emptyCollectionPage))
      .mockResolvedValueOnce(Response.json(emptyNavigation))
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

  it("browses Timeline photos and opens the contextual Photo Viewer", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(onePhotoCollectionPage))
      .mockResolvedValueOnce(Response.json(emptyNavigation))
      .mockResolvedValueOnce(Response.json(viewerBootstrap));

    renderApp(<App />);

    const photoLink = await screen.findByRole("link", { name: /beach\.jpg/ });
    await userEvent.click(photoLink);

    expect(await screen.findByRole("img", { name: "beach.jpg" })).toHaveAttribute(
      "src",
      "https://temporary.example/display.jpg",
    );
    // The originating Timeline route stays mounted underneath the modal, just hidden from the accessibility tree (ADR-0063).
    expect(screen.getByRole("link", { hidden: true, name: /beach\.jpg/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Photo information" }));
    expect(await screen.findByText("Canon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "beach.jpg" })).not.toBeInTheDocument());
  });
});
