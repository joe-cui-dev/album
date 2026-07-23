import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelinePhotoV2 } from "@album/shared";
import { renderApp } from "../../test/test-utils.js";
import { BrowsingGrid } from "./BrowsingGrid.js";
import { createBrowsingWindow, type BrowsingWindow } from "./browsingWindow.js";
import { createTestAlbumBrowsingPort, type TestAlbumBrowsingPort } from "./testAlbumBrowsingPort.js";

/** A data router, not plain `MemoryRouter` -- `PhotoLink`'s `useViewTransitionState` requires one,
 * matching the `createBrowserRouter` the real app renders under (`App.tsx`). */
const renderWithRouter = (node: ReactNode) => renderApp(<RouterProvider router={createMemoryRouter([{ path: "*", Component: () => node }])} />);

const layout = { containerWidth: 1000, spacing: 4, targetRowHeight: 200 };

const photo = (photoId: string, overrides: Partial<TimelinePhotoV2> = {}): TimelinePhotoV2 => ({
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
    browsingWindow?.dispose();
  });

  const emptyState = { title: "Empty", description: "Nothing here yet" };

  it("renders a month marker and Photo links once the initial page loads", async () => {
    test = createTestAlbumBrowsingPort();
    browsingWindow = createBrowsingWindow({ collection: "active", port: test.port, layout });

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
    browsingWindow = createBrowsingWindow({ collection: "archived", port: test.port, layout });

    renderWithRouter(
      <BrowsingGrid browsingWindow={browsingWindow} emptyState={emptyState} photoHrefFor={(id) => `/album/photos/${id}`} sourceCollection="active" />,
    );

    test.resolveNextLoad({ photos: [] });

    expect(await screen.findByRole("heading", { name: "Empty" })).toBeInTheDocument();
  });

  it("surfaces an incremental load error with a retry action", async () => {
    test = createTestAlbumBrowsingPort();
    browsingWindow = createBrowsingWindow({ collection: "active", port: test.port, layout });
    test.resolveNextLoad({ photos: [photo("a")], nextCursor: "cursor-1" });
    await flush();

    renderWithRouter(
      <BrowsingGrid browsingWindow={browsingWindow} emptyState={emptyState} photoHrefFor={(id) => `/album/photos/${id}`} sourceCollection="active" />,
    );

    browsingWindow.intents.loadMore();
    test.rejectNextLoad(new Error("boom"));

    expect(await screen.findByText("Couldn't load more photos.")).toBeInTheDocument();
  });
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
