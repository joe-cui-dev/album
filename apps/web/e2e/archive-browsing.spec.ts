import { buildPhoto, collectionPage, emptyNavigation, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("browses read-only Archive without any mutation actions", async ({ mock, page }) => {
  const archivedPhoto = buildPhoto({ fileName: "archived.jpg" });
  mock.archive.queueOnce((route) => respondJson(route, collectionPage([archivedPhoto])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album/archive");

  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("link", { name: /archived\.jpg/ })).toBeVisible();
  // Archive Photo, Restore Photo, and Undo remain later work (implementation doc "Deferred Work").
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^archive photo/i })).toHaveCount(0);
});

test("shows Archive's own empty state, distinct from Timeline's", async ({ mock, page }) => {
  mock.archive.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album/archive");

  await expect(page.getByRole("heading", { name: "Your archive is empty" })).toBeVisible();
});
