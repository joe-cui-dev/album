import {
  buildPhoto,
  buildViewerBootstrap,
  collectionPage,
  emptyNavigation,
  respondAlbumError,
  respondJson,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

// Distinct months guarantee `beach` and `mountain` land in different Justified Rows (a period
// boundary always breaks a row), so archiving one can never reflow the other's row (ADR-0067).
const beachCapturedAt = { precision: "day", localDate: "2025-02-10" } as const;
const mountainCapturedAt = { precision: "day", localDate: "2025-01-05" } as const;

test("archives a Photo from the contextual Viewer, an unrelated row doesn't reflow, and the Viewer advances", async ({
  mock,
  page,
}) => {
  const first = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg", capturedAt: beachCapturedAt });
  const second = buildPhoto({ photoId: "photo-2", fileName: "mountain.jpg", capturedAt: mountainCapturedAt });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([first, second])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(
      route,
      buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg", olderPhotoId: "photo-2" }),
    ),
  );

  await page.goto("/album");
  const mountainLink = page.getByRole("link", { name: /mountain\.jpg/ });
  const mountainBoxBefore = await mountainLink.boundingBox();
  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  await expect(page.getByRole("dialog", { name: "beach.jpg" })).toBeVisible();

  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-2", fileName: "mountain.jpg" })),
  );
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Archive photo" }).click();

  // The Viewer advances toward the older neighbour once the archive intent fires.
  await expect(page.getByRole("dialog", { name: "mountain.jpg" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toHaveCount(0);
  const mountainBoxAfter = await mountainLink.boundingBox();
  expect(mountainBoxAfter).toEqual(mountainBoxBefore);

  await expect(page.getByRole("status")).toContainText("Photo moved to Archive");
});

test("Undo restores the Photo without disturbing the unrelated row", async ({ mock, page }) => {
  const first = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg", capturedAt: beachCapturedAt });
  const second = buildPhoto({ photoId: "photo-2", fileName: "mountain.jpg", capturedAt: mountainCapturedAt });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([first, second])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(
      route,
      buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg", olderPhotoId: "photo-2" }),
    ),
  );

  await page.goto("/album");
  const mountainLink = page.getByRole("link", { name: /mountain\.jpg/ });
  const mountainBoxBefore = await mountainLink.boundingBox();
  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-2", fileName: "mountain.jpg" })),
  );
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Archive photo" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toHaveCount(0);

  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  await page.getByRole("button", { name: "Undo" }).click();

  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
  const mountainBoxAfter = await mountainLink.boundingBox();
  expect(mountainBoxAfter).toEqual(mountainBoxBefore);
});

test("a failed archive returns the Photo to the Timeline and shows a persistent error, without a late backwards jump", async ({
  mock,
  page,
}) => {
  const first = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([first])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );

  await page.goto("/album");
  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  await expect(page.getByRole("dialog", { name: "beach.jpg" })).toBeVisible();

  mock.archiveMembership.queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Internal error"));

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Archive photo" }).click();

  // No older/newer neighbour, so the Viewer advances by closing immediately -- the design
  // deliberately does not yank it backwards once the later failure arrives (ADR-0068).
  await expect(page).toHaveURL("/album");
  await expect(page.getByRole("status")).toContainText(/couldn't archive/i);
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
});
