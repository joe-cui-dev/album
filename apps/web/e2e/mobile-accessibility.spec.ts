import { buildPhoto, collectionPage, navigationWithYears, respondAfterDelay, respondAlbumError, respondJson } from "./fixtures/albumApiMock.js";
import { expectNoAxeViolations } from "./fixtures/axeHelpers.js";
import { expect, test } from "./fixtures/test.js";

/**
 * Axe scans for the "mobile Jump to date" states from execution-plan Slice 0.2's list,
 * kept in their own file (rather than `test.describe` inside accessibility.spec.ts) since
 * they need a 360px viewport for the whole file via `test.use`.
 */
test.use({ viewport: { width: 360, height: 740 } });

const withYears = () => navigationWithYears({ timelineYears: [{ year: 2025, counts: { "05": 1, "06": 1 } }] });

test("mobile Jump to date default sheet renders without axe violations", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "june.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, withYears()));
  await page.goto("/album");
  await page.getByRole("button", { name: "Jump to date" }).click();
  await expect(page.getByRole("dialog", { name: "Jump to date" })).toBeVisible();
  await expectNoAxeViolations(page);
});

// The sheet retains itself while a candidate loads (Slice 4.2), so the pending status is a
// scannable mobile-scoped state in its own right.
test("mobile Jump to date pending state renders without axe violations", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "june.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([photo])))
    .queueOnce((route) => respondAfterDelay(route, 2_000, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, withYears()));
  await page.goto("/album");
  await page.getByRole("button", { name: "Jump to date" }).click();
  const sheet = page.getByRole("dialog", { name: "Jump to date" });
  await sheet.getByRole("button", { name: "Expand 2025" }).click();
  await sheet.getByRole("button", { name: "May 2025" }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("status")).toHaveText("Loading that period…");
  await expectNoAxeViolations(page);
});

// The sheet stays open (Slice 4.2) and shows/announces the outcome in place, rather than
// closing immediately and leaving the status on the main page.
test("mobile Jump to date empty-period notice renders without axe violations", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "june.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([photo])))
    .queueOnce((route) => respondJson(route, { code: "empty_period", message: "Period is empty" }, 409));
  mock.navigation.queueOnce((route) => respondJson(route, withYears()));
  await page.goto("/album");
  await page.getByRole("button", { name: "Jump to date" }).click();
  const sheet = page.getByRole("dialog", { name: "Jump to date" });
  await sheet.getByRole("button", { name: "Expand 2025" }).click();
  await sheet.getByRole("button", { name: "May 2025" }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("status")).toHaveText("That period is now empty.");
  await expectNoAxeViolations(page);
});

test("mobile Jump to date retryable failure notice renders without axe violations", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "june.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  mock.timeline
    .queueOnce((route) => respondJson(route, collectionPage([photo])))
    .queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"));
  mock.navigation.queueOnce((route) => respondJson(route, withYears()));
  await page.goto("/album");
  await page.getByRole("button", { name: "Jump to date" }).click();
  const sheet = page.getByRole("dialog", { name: "Jump to date" });
  await sheet.getByRole("button", { name: "Expand 2025" }).click();
  await sheet.getByRole("button", { name: "May 2025" }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("alert")).toContainText("Couldn't jump to that date.");
  await expectNoAxeViolations(page);
});
