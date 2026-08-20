import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AlbumNavigationResponse,
  GetProcessingIssuesSummaryResponse,
  ListCollectionPhotosResponse,
  ViewerBootstrapResponse,
} from "@album/shared";
import { App } from "./App.js";
import { sessionExpiredEvent } from "./lib/sessionEvents.js";
import { renderApp } from "./test/test-utils.js";

const apiBaseUrl =
  "https://replace-with-http-api-id.execute-api.ap-southeast-2.amazonaws.com";

const session = { signedIn: true, user: { userId: "user-1", email: "joe@example.com" } };

const emptyNavigation: AlbumNavigationResponse = {
  timeline: { years: [] },
  trash: { years: [] },
  favourites: { years: [] },
  processingIssueCount: 0,
};

const emptySummary: GetProcessingIssuesSummaryResponse = { openCount: 0 };

const emptyCollectionPage: ListCollectionPhotosResponse = { photos: [] };

const onePhotoCollectionPage: ListCollectionPhotosResponse = {
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
      favourite: false,
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
  trashed: false,
  favourite: false,
  collection: "active",
  displayAccess: { url: "https://temporary.example/display.jpg", expiresAt: "2099-01-01T00:00:00.000Z" },
};

/**
 * The signed-in album mounts several independent, concurrently-firing reads
 * (Timeline/Trash page, Album Navigation, Processing Issues summary); their
 * relative fetch order isn't a contract worth pinning down in a component
 * test, so this dispatches by pathname/method instead of a positional
 * `mockResolvedValueOnce` chain.
 */
const mockSignedInFetch = (overrides: {
  timeline?: ListCollectionPhotosResponse;
  trash?: ListCollectionPhotosResponse;
  navigation?: AlbumNavigationResponse;
  summary?: GetProcessingIssuesSummaryResponse;
  viewer?: ViewerBootstrapResponse;
} = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/session" && method === "GET") {
      return Response.json(session);
    }
    if (url.pathname === "/session" && method === "DELETE") {
      return Response.json({ signedIn: false });
    }
    if (url.pathname === "/timeline" && method === "GET") {
      return Response.json(overrides.timeline ?? emptyCollectionPage);
    }
    if (url.pathname === "/trash" && method === "GET") {
      return Response.json(overrides.trash ?? emptyCollectionPage);
    }
    if (url.pathname === "/album-navigation" && method === "GET") {
      return Response.json(overrides.navigation ?? emptyNavigation);
    }
    if (url.pathname === "/processing-issues/summary" && method === "GET") {
      return Response.json(overrides.summary ?? emptySummary);
    }
    if (/^\/photos\/[^/]+\/viewer$/.test(url.pathname) && method === "GET" && overrides.viewer) {
      return Response.json(overrides.viewer);
    }

    throw new Error(`Unmocked fetch: ${method} ${url.pathname}`);
  });

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

  it("gives an empty signed-in album a single clear next action that opens the Upload Tray", async () => {
    mockSignedInFetch();

    renderApp(<App />);

    expect(await screen.findByRole("navigation", { name: "Album" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your album is empty" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("heading", { name: "Your album is empty" }).parentElement!)
        .getByRole("button", { name: "Add photos" }),
    ).toBeInTheDocument();
  });

  it("keeps Trash behind the signed-in application route", async () => {
    window.history.replaceState({}, "", "/album/trash");
    mockSignedInFetch();

    renderApp(<App />);

    expect(
      await screen.findByRole("heading", { name: "Your trash is empty" }),
    ).toBeInTheDocument();
  });

  it("redirects an unknown /album/* path back to the album (the Tray has no route of its own)", async () => {
    window.history.replaceState({}, "", "/album/upload");
    mockSignedInFetch();

    renderApp(<App />);

    expect(await screen.findByRole("heading", { name: "Your album is empty" })).toBeInTheDocument();
  });

  it("opens the Upload Tray from the shell's Add Photos button", async () => {
    mockSignedInFetch();

    renderApp(<App />);
    const nav = await screen.findByRole("navigation", { name: "Album" });
    await userEvent.click(within(nav).getByRole("button", { name: "Add photos" }));

    expect(await screen.findByLabelText("Choose photos")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add photos" })).toBeInTheDocument();
  });

  it("returns to sign-in when a protected request reports an expired session", async () => {
    mockSignedInFetch();

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

  it("requests a sign-in code on the same page and reveals the code field", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ signedIn: false }))
      .mockResolvedValueOnce(Response.json({ accepted: true }));

    renderApp(<App />);

    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "joe@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
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
    window.history.replaceState({}, "", "/album/trash");
    const fetch = mockSignedInFetch();

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
    mockSignedInFetch({ timeline: onePhotoCollectionPage, viewer: viewerBootstrap });

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

  it("uses the central source label in Viewer Info and opens the date-and-time editor from More", async () => {
    mockSignedInFetch({ timeline: onePhotoCollectionPage, viewer: viewerBootstrap });
    renderApp(<App />);
    await userEvent.click(await screen.findByRole("link", { name: /beach\.jpg/ }));

    await userEvent.click(screen.getByRole("button", { name: "Photo information" }));
    expect(await screen.findByText("Date from photo")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust date and time" }));
    const editor = await screen.findByRole("dialog", { name: "Adjust date and time" });
    expect(within(editor).getByLabelText("Date")).toHaveValue("");
    expect(within(editor).getByLabelText("Date")).toHaveFocus();

    await userEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Adjust date and time" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();
  });
});
