import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelinePhoto } from "@album/shared";
import { renderApp } from "../../test/test-utils.js";
import { BrowsingGrid } from "./BrowsingGrid.js";
import { createBrowsingWindow, type BrowsingWindow } from "./browsingWindow.js";
import { createTestAlbumBrowsingPort, type TestAlbumBrowsingPort } from "./testAlbumBrowsingPort.js";
import { createTestBrowsingEnvironment } from "./testBrowsingEnvironment.js";

/** A data router, not plain `MemoryRouter` -- `PhotoLink`'s `useViewTransitionState` requires one,
 * matching the `createBrowserRouter` the real app renders under (`App.tsx`). */
const renderWithRouter = (node: ReactNode) => renderApp(<RouterProvider router={createMemoryRouter([{ path: "*", Component: () => node }])} />);

const layout = { containerWidth: 1000, spacing: 4, targetRowHeight: 200 };

const photo = (photoId: string, overrides: Partial<TimelinePhoto> = {}): TimelinePhoto => ({
  photoId,
  fileName: `${photoId}.jpg`,
  capturedAt: { precision: "month", localDate: "2024-07" },
  addedAt: "2026-01-01T00:00:00.000Z",
  displayDimensions: { width: 200, height: 100 },
  timelineThumbnailSources: {
    large: { url: `https://example.invalid/${photoId}-large.jpg`, dimensions: { width: 640, height: 320 } },
  },
  ...overrides,
});

describe("BrowsingGrid", () => {
  let test: TestAlbumBrowsingPort;
  let browsingWindow: BrowsingWindow | undefined;

  afterEach(() => {
    browsingWindow?.lifecycle.dispose();
  });

  const emptyState = { title: "Empty", description: "Nothing here yet" };

  /** Registry-equivalent setup: activate before mounting, exactly like `BrowsingPage` does via the registry. */
  const createActiveWindow = (port: TestAlbumBrowsingPort["port"]): BrowsingWindow => {
    const window_ = createBrowsingWindow({ collection: "active", port, layout, environment: createTestBrowsingEnvironment().environment });
    window_.lifecycle.activate();
    return window_;
  };

  it("renders a month marker and Photo links once the initial page loads", async () => {
    test = createTestAlbumBrowsingPort();
    browsingWindow = createActiveWindow(test.port);

    renderWithRouter(
      <BrowsingGrid browsingWindow={browsingWindow} emptyState={emptyState} photoHrefFor={(id) => `/album/photos/${id}`} sourceCollection="active" />,
    );

    test.resolveNextLoad({ photos: [photo("a"), photo("b")], expiresAt: "2030-01-01T00:00:00.000Z" });

    expect(await screen.findByRole("heading", { name: /July 2024/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /a\.jpg/ })).toHaveAttribute("href", "/album/photos/a");
    expect(screen.getByRole("link", { name: /b\.jpg/ })).toHaveAttribute("href", "/album/photos/b");
  });

  it("shows the empty state once loading finishes with no Photos", async () => {
    test = createTestAlbumBrowsingPort();
    browsingWindow = createActiveWindow(test.port);

    renderWithRouter(
      <BrowsingGrid browsingWindow={browsingWindow} emptyState={emptyState} photoHrefFor={(id) => `/album/photos/${id}`} sourceCollection="active" />,
    );

    test.resolveNextLoad({ photos: [] });

    expect(await screen.findByRole("heading", { name: "Empty" })).toBeInTheDocument();
  });

  it("surfaces an initial load failure with a retry action", async () => {
    test = createTestAlbumBrowsingPort();
    browsingWindow = createActiveWindow(test.port);

    renderWithRouter(
      <BrowsingGrid browsingWindow={browsingWindow} emptyState={emptyState} photoHrefFor={(id) => `/album/photos/${id}`} sourceCollection="active" />,
    );

    test.rejectNextLoad(new Error("boom"));

    expect(await screen.findByText("Couldn't load photos.")).toBeInTheDocument();
  });

  it("surfaces an incremental (tail) load failure with a retry action once rows exist", async () => {
    test = createTestAlbumBrowsingPort();
    browsingWindow = createActiveWindow(test.port);

    renderWithRouter(
      <BrowsingGrid browsingWindow={browsingWindow} emptyState={emptyState} photoHrefFor={(id) => `/album/photos/${id}`} sourceCollection="active" />,
    );

    // A lone small Photo can't fill a row on its own, so it stays a withheld incomplete tail while
    // the cursor continues -- forcing an automatic second page request. Rejecting that surfaces a
    // tail-failure (rows already retained) rather than an initial one.
    test.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1", expiresAt: "2030-01-01T00:00:00.000Z" });
    await flush();
    test.rejectNextLoad(new Error("boom"));

    expect(await screen.findByText("Couldn't load more photos.")).toBeInTheDocument();
  });
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
