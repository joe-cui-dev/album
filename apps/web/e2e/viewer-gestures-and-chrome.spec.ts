import { buildViewerBootstrap, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("Viewer zoom control, Info disclosure, and More keyboard menu follow their accessible contracts", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) => respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg", displayDimensions: { width: 1600, height: 1200 } })));
  await page.goto("/album/photos/photo-1");
  await expect(page.getByRole("img", { name: "beach.jpg" })).toBeVisible();

  const zoom = page.getByRole("button", { name: "View at 100%" });
  await zoom.click();
  await expect(page.getByRole("button", { name: "Fit to screen" })).toBeVisible();
  await page.getByRole("button", { name: "Fit to screen" }).click();

  const info = page.getByRole("button", { name: "Photo information" });
  await info.click();
  await expect(page.getByRole("region", { name: "Photo information" })).toBeVisible();
  await expect(info).toHaveAttribute("aria-expanded", "true");

  const more = page.getByRole("button", { name: "More" });
  await more.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Adjust date and time" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Download original" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
});

test("a Fit-stage horizontal pointer swipe opens the older Photo", async ({ mock, page }) => {
  mock.viewer
    .queueOnce((route) => respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg", olderPhotoId: "photo-2" })))
    // Decode prefetches the adjacent Photo before the navigation request.
    .queueOnce((route) => respondJson(route, buildViewerBootstrap({ photoId: "photo-2", fileName: "older.jpg", newerPhotoId: "photo-1" })))
    .queueOnce((route) => respondJson(route, buildViewerBootstrap({ photoId: "photo-2", fileName: "older.jpg", newerPhotoId: "photo-1" })));
  await page.goto("/album/photos/photo-1");
  await expect(page.getByRole("img", { name: "beach.jpg" })).toBeVisible();
  await page.mouse.move(700, 350);
  await page.mouse.down();
  await page.mouse.move(500, 352, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole("img", { name: "older.jpg" })).toBeVisible();
});
