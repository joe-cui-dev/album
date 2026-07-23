import {
  buildPhoto,
  buildViewerBootstrap,
  collectionPage,
  emptyNavigation,
  respondAlbumError,
  respondJson,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("Photo Viewer Display Access failure recovers via Retry", async ({ mock, page }) => {
  mock.viewer
    .queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"))
    .queueOnce((route) => respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })));

  await page.goto("/album/photos/photo-1");

  await expect(page.getByText("Couldn't load this photo.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("img", { name: "beach.jpg" })).toBeVisible();
});

test("a failed Thumbnail Access renewal leaves the existing thumbnail source in place", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "beach.jpg" });
  // An expiry inside the 60s renewal-lead window makes the Grid renew immediately on mount
  // (implementation doc "Loading and Image Access").
  mock.timeline.queueOnce((route) =>
    respondJson(route, collectionPage([photo], { expiresAt: new Date(Date.now() + 30_000).toISOString() })),
  );
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.thumbnailAccess.queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"));

  await page.goto("/album");

  const photoLink = page.getByRole("link", { name: /beach\.jpg/ });
  await expect(photoLink).toBeVisible();
  // The failed renewal is swallowed and retried later; it must not surface as a blocking Grid error.
  await expect(page.getByText("Couldn't load more photos.")).toHaveCount(0);
  await expect(photoLink.locator("img")).toHaveAttribute("src", /^data:image\/png/);
});
