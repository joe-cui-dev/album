import {
  buildPhoto,
  buildViewerBootstrap,
  collectionPage,
  emptyNavigation,
  respondJson,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("favourites a Photo from the Viewer, and it appears in the Favourites view", async ({ mock, page }) => {
  const photo = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg", favourite: false })),
  );

  await page.goto("/album");
  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  await expect(page.getByRole("dialog", { name: "beach.jpg" })).toBeVisible();

  const favouriteRequest = page.waitForRequest(
    (request) => /\/photos\/photo-1\/favourite$/.test(request.url()) && request.method() === "PUT",
  );
  await page.getByRole("button", { name: "Favourite" }).click();
  await favouriteRequest;
  await expect(page.getByRole("button", { name: "Unfavourite" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/album");

  const favouritedPhoto = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg", favourite: true });
  mock.favourites.queueOnce((route) => respondJson(route, collectionPage([favouritedPhoto])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.getByRole("navigation", { name: "Album" }).getByRole("link", { name: "Favourites" }).click();

  await expect(page.getByRole("heading", { name: "Favourites", level: 1 })).toBeVisible();
  const favouriteLink = page.getByRole("link", { name: /beach\.jpg/ });
  await expect(favouriteLink).toBeVisible();
  // Favourites renders no heart badge/suffix -- every cell there is already favourited (decision 6).
  // (Not `/Favourite/` alone -- that also matches the "Favourites" nav link's own name.)
  await expect(page.getByRole("link", { name: /, Favourite$/ })).toHaveCount(0);
});

test("unfavouriting from the Favourites Viewer withholds the Photo on return, and Undo restores it", async ({
  mock,
  page,
}) => {
  const photo = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg", favourite: true });
  mock.favourites.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(
      route,
      buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg", favourite: true, collection: "favourite" }),
    ),
  );

  await page.goto("/album/favourites");
  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  await expect(page.getByRole("dialog", { name: "beach.jpg" })).toBeVisible();

  const unfavouriteRequest = page.waitForRequest(
    (request) => /\/photos\/photo-1\/favourite$/.test(request.url()) && request.method() === "DELETE",
  );
  await page.getByRole("button", { name: "Unfavourite" }).click();
  await unfavouriteRequest;

  // Unfavouriting out of the Favourites view itself is the one case that earns Undo feedback
  // (decision 5): the Photo is about to disappear from the view it was opened from.
  await expect(page.getByRole("status")).toContainText("Removed from Favourites");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/album/favourites");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toHaveCount(0);

  const undoRequest = page.waitForRequest(
    (request) => /\/photos\/photo-1\/favourite$/.test(request.url()) && request.method() === "PUT",
  );
  await page.getByRole("button", { name: "Undo" }).click();
  await undoRequest;

  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
});

test("shows discovery copy in an empty Favourites view", async ({ mock, page }) => {
  mock.favourites.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.goto("/album/favourites");

  await expect(page.getByRole("heading", { name: "No favourites yet" })).toBeVisible();
  await expect(page.getByText(/tap the heart/i)).toBeVisible();
});

test("the mobile dock fits a fourth item (Favourites alongside Processing Issues) at 375px without overflow", async ({
  mock,
  page,
}) => {
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.processingIssuesSummary.queueOnce((route) => respondJson(route, { openCount: 3 }));

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/album");

  const dock = page.getByRole("navigation", { name: "Album destinations" });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("link", { name: "Favourites" })).toBeVisible();
  await expect(dock.getByRole("link", { name: /Needs attention/ })).toBeVisible();

  const items = dock.locator(":scope > a, :scope > button");
  await expect(items).toHaveCount(4);

  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  // The dock stays within the 375px viewport -- no horizontal overflow from the extra item.
  expect(dockBox!.x).toBeGreaterThanOrEqual(0);
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(375);

  // Every item gets a genuinely distinct, non-overlapping slot (CSS grid's equal columns).
  const boxes = await items.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON()),
  );
  expect(boxes).toHaveLength(4);
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  for (let index = 1; index < sorted.length; index += 1) {
    expect(sorted[index]!.x).toBeGreaterThanOrEqual(sorted[index - 1]!.x + sorted[index - 1]!.width - 1);
  }
});
