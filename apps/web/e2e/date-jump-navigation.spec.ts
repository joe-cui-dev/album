import { buildPhoto, collectionPage, navigationWithYears, respondJson } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("commits a manual date Jump and restores the prior view on Back", async ({ mock, page }) => {
  const junePhoto = buildPhoto({ fileName: "june.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  const mayPhoto = buildPhoto({ fileName: "may.jpg", capturedAt: { precision: "day", localDate: "2025-05-10" } });

  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([junePhoto])))
    .queueOnce((route) => respondJson(route, collectionPage([mayPhoto])));
  mock.navigation.queueOnce((route) =>
    respondJson(route, navigationWithYears({ timelineYears: [{ year: 2025, counts: { "05": 1, "06": 1 } }] })),
  );

  await page.goto("/album");
  await expect(page.getByRole("link", { name: /june\.jpg/ })).toBeVisible();

  await page.getByRole("button", { name: "Expand 2025" }).click();
  await page.getByRole("button", { name: "May 2025" }).click();

  await expect(page).toHaveURL(/startAt=2025-05/);
  await expect(page.getByRole("link", { name: /may\.jpg/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /june\.jpg/ })).toHaveCount(0);

  await page.goBack();

  // The prior window is retained (implementation doc "BrowsingWindow Module"), so June's photo
  // reappears without a third Timeline request -- the mock queue above only has two responses.
  await expect(page).not.toHaveURL(/startAt=/);
  await expect(page.getByRole("link", { name: /june\.jpg/ })).toBeVisible();
});

test("shows an inline notice and leaves history untouched when the target period is empty", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "june.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });

  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([photo])))
    .queueOnce((route) => respondJson(route, { code: "empty_period", message: "Period is empty" }, 409));
  mock.navigation.queueOnce((route) =>
    respondJson(route, navigationWithYears({ timelineYears: [{ year: 2025, counts: { "01": 1, "06": 1 } }] })),
  );

  await page.goto("/album");
  await expect(page.getByRole("link", { name: /june\.jpg/ })).toBeVisible();

  await page.getByRole("button", { name: "Expand 2025" }).click();
  await page.getByRole("button", { name: "January 2025" }).click();

  await expect(page.getByText("That period is now empty.")).toBeVisible();
  await expect(page).not.toHaveURL(/startAt=/);
  await expect(page.getByRole("link", { name: /june\.jpg/ })).toBeVisible();
});
