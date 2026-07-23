import { buildPhoto, buildViewerBootstrap, collectionPage, navigationWithYears, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

/**
 * 360px mobile Chromium functional smoke (execution plan Slice 0.1). Runs only under the
 * `mobile-chromium` Playwright project (see `playwright.config.ts`): Chromium engine, 360px viewport.
 */
test("360px mobile Chromium: browses Timeline, jumps via the mobile sheet, and opens the Viewer", async ({ mock, page }) => {
  const photo = buildPhoto({ photoId: "photo-1", fileName: "beach.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  const mayPhoto = buildPhoto({ fileName: "may.jpg", capturedAt: { precision: "day", localDate: "2025-05-01" } });

  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([photo])))
    .queueOnce((route) => respondJson(route, collectionPage([mayPhoto])));
  mock.navigation.queueOnce((route) =>
    respondJson(route, navigationWithYears({ timelineYears: [{ year: 2025, counts: { "05": 1, "06": 1 } }] })),
  );
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );

  await page.goto("/album");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();

  await page.getByRole("button", { name: "Jump to date" }).click();
  const sheet = page.getByRole("dialog", { name: "Jump to date" });
  await expect(sheet).toBeVisible();

  await sheet.getByRole("button", { name: "Expand 2025" }).click();
  await sheet.getByRole("button", { name: "May 2025" }).click();

  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/startAt=2025-05/);
  await expect(page.getByRole("link", { name: /may\.jpg/ })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();

  await page.getByRole("link", { name: /beach\.jpg/ }).click();
  const dialog = page.getByRole("dialog", { name: "beach.jpg" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});
