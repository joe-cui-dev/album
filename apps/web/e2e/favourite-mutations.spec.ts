import {
  buildPhoto,
  buildViewerBootstrap,
  collectionPage,
  emptyNavigation,
  respondJson,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("toggles Favourite from the persistent Viewer heart button", async ({ mock, page }) => {
  const photo = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );

  await page.goto("/album");
  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  await expect(page.getByRole("dialog", { name: "beach.jpg" })).toBeVisible();

  const favouriteButton = page.getByRole("button", { name: "Favourite" });
  await expect(favouriteButton).toHaveAttribute("aria-pressed", "false");

  const favouriteRequest = page.waitForRequest(
    (request) => /\/photos\/photo-1\/favourite$/.test(request.url()) && request.method() === "PUT",
  );
  await favouriteButton.click();
  await favouriteRequest;

  const unfavouriteButton = page.getByRole("button", { name: "Unfavourite" });
  await expect(unfavouriteButton).toHaveAttribute("aria-pressed", "true");

  const unfavouriteRequest = page.waitForRequest(
    (request) => /\/photos\/photo-1\/favourite$/.test(request.url()) && request.method() === "DELETE",
  );
  await unfavouriteButton.click();
  await unfavouriteRequest;

  await expect(page.getByRole("button", { name: "Favourite" })).toHaveAttribute("aria-pressed", "false");
});
