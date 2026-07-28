import { buildPhoto, collectionPage, emptyNavigation, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("browses read-only Trash without any mutation actions", async ({ mock, page }) => {
  const trashedPhoto = buildPhoto({ fileName: "trashed.jpg" });
  mock.trash.queueOnce((route) => respondJson(route, collectionPage([trashedPhoto])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album/trash");

  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect(page.getByRole("link", { name: /trashed\.jpg/ })).toBeVisible();
  // Trash Photo, Restore Photo, and Undo remain later work (implementation doc "Deferred Work").
  await expect(page.getByRole("button", { name: /restore/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^trash photo/i })).toHaveCount(0);
});

test("shows Trash's own empty state, distinct from Timeline's", async ({ mock, page }) => {
  mock.trash.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album/trash");

  await expect(page.getByRole("heading", { name: "Your trash is empty" })).toBeVisible();
});
