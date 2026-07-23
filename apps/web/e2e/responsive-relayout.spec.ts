import { buildPhoto, collectionPage, emptyNavigation, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

// Scope note: `BrowsingGrid`'s scrollToIndex restoration (implementation doc "Scroll restoration")
// only fires once per mount, not on every live resize, so this deliberately checks de-duplication
// and row-boundary integrity across widths rather than pixel-exact relative-offset recreation.
test("keeps the loaded Timeline intact, with no duplicated rows, across a responsive width change", async ({
  mock,
  page,
}) => {
  const photos = Array.from({ length: 10 }, (_, index) =>
    buildPhoto({
      fileName: `photo-${index}.jpg`,
      capturedAt: { precision: "day", localDate: `2025-01-${String(index + 1).padStart(2, "0")}` },
    }),
  );
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage(photos)));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/album");

  const anchorLink = page.getByRole("link", { name: /photo-0\.jpg/ });
  await expect(anchorLink).toBeVisible();

  // Justified Rows recomputes for the new container width; no row may crop a Photo or cross a
  // period boundary, and the anchor Photo must never be duplicated by the re-layout
  // (implementation doc "Justified Rows and Virtualisation"). Distant rows are legitimately
  // unmounted by virtualization at narrower widths, so this only re-checks the anchor itself.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(anchorLink).toHaveCount(1);
  await expect(anchorLink).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(anchorLink).toHaveCount(1);
  await expect(anchorLink).toBeVisible();

  // The one month marker is never duplicated by re-layout either.
  const monthMarker = page.getByRole("heading", { name: "January 2025" });
  await expect(monthMarker).toHaveCount(1);

  // Mobile stacks date navigation above the page heading, leaving the Timeline the full
  // content width instead of preserving the desktop navigation column beside it.
  const jumpButtonBox = await page.getByRole("button", { name: "Jump to date" }).boundingBox();
  const pageHeadingBox = await page.getByRole("heading", { name: "Album", level: 1 }).boundingBox();
  const monthMarkerBox = await monthMarker.boundingBox();
  expect(jumpButtonBox).not.toBeNull();
  expect(pageHeadingBox).not.toBeNull();
  expect(monthMarkerBox).not.toBeNull();
  expect(jumpButtonBox!.y + jumpButtonBox!.height).toBeLessThanOrEqual(pageHeadingBox!.y);
  expect(monthMarkerBox!.width).toBeCloseTo(pageHeadingBox!.width, 0);
});
