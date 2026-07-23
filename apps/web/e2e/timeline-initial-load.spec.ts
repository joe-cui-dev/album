import {
  buildPhoto,
  collectionPage,
  emptyNavigation,
  respondAlbumError,
  respondJson,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("automatically loads the Timeline without any user action", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album");

  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
  // No "Load" or "Browse" affordance exists; the page has nothing left for the user to click to see photos.
  await expect(page.getByRole("button", { name: /load/i })).toHaveCount(0);
});

test("recovers from an incremental page-load failure via Retry", async ({ mock, page }) => {
  const firstPagePhoto = buildPhoto({ fileName: "first-page.jpg" });
  const secondPagePhoto = buildPhoto({ fileName: "second-page.jpg" });

  // A small first page (one row) with a `nextCursor` immediately trips the Grid's
  // "near the loaded end" threshold, so the second ("more") request fires on its own.
  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([firstPagePhoto], { nextCursor: "cursor-1" })))
    .queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"))
    .queueOnce((route) => respondJson(route, collectionPage([secondPagePhoto])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album");

  await expect(page.getByRole("link", { name: /first-page\.jpg/ })).toBeVisible();
  await expect(page.getByText("Couldn't load more photos.")).toBeVisible();

  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("link", { name: /second-page\.jpg/ })).toBeVisible();
  await expect(page.getByText("Couldn't load more photos.")).not.toBeVisible();
});
