import { buildPhoto, buildViewerBootstrap, collectionPage, emptyNavigation, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("contextual route opens as a modal over Timeline and returns focus on Close", async ({ mock, page }) => {
  const photo = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );

  await page.goto("/album");
  const photoLink = page.getByRole("link", { name: /beach\.jpg/ });
  await expect(photoLink).toBeVisible();
  await photoLink.click();

  await expect(page).toHaveURL("/album/photos/photo-1");
  const dialog = page.getByRole("dialog", { name: "beach.jpg" });
  await expect(dialog).toBeVisible();
  // The background Timeline route stays mounted underneath the modal, hidden from the accessibility tree (ADR-0063).
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toHaveCount(0);

  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/album");
  await expect(dialog).toHaveCount(0);
  await expect(photoLink).toBeFocused();
});

test("direct route loads a standalone Darkroom page and Close focuses the destination heading", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );

  await page.goto("/album/photos/photo-1");

  await expect(page.getByRole("img", { name: "beach.jpg" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Close infers the resolved Timeline collection and mounts it fresh -- nothing was preloaded for a direct load.
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.getByRole("button", { name: "Close" }).click();

  await expect(page).toHaveURL("/album");
  await expect(page.getByRole("heading", { name: "Album", exact: true })).toBeFocused();
});

test("a direct Viewer route for an archived Photo closes back to Archive", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) =>
    respondJson(
      route,
      buildViewerBootstrap({
        photoId: "photo-1",
        fileName: "archived.jpg",
        archived: true,
        collection: "archived",
      }),
    ),
  );

  await page.goto("/album/photos/photo-1");
  await expect(page.getByRole("img", { name: "archived.jpg" })).toBeVisible();

  mock.archive.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.getByRole("button", { name: "Close" }).click();

  await expect(page).toHaveURL("/album/archive");
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeFocused();
});

test("traps Tab focus within the contextual Viewer", async ({ mock, page }) => {
  const photo = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );

  await page.goto("/album");
  await page.getByRole("link", { name: /beach\.jpg/ }).click();

  const closeButton = page.getByRole("button", { name: "Close" });
  await expect(closeButton).toBeFocused();

  // No Previous/Next neighbours are present, so Close, Info, and More are the only
  // focusable elements in the trap; Shift+Tab from the first must wrap to the last.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "More" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
});
