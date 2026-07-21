import { buildPhoto, collectionPage, navigationWithYears, respondAlbumError, respondJson } from "./fixtures/albumApiMock.js";
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

// Gap: the sheet does not yet retain itself while a candidate loads (execution plan
// Slice 4.2), so a pending Jump closes the sheet immediately and leaves no visible
// mobile-scoped pending affordance to scan. Traceable to that slice, not scanned here.
test.fixme("mobile Jump to date pending state renders without axe violations", async () => {});

// Gap: closing on jump (Slice 4.2) means these status messages render on the main page,
// not inside the sheet -- scanning the page still exercises the state honestly.
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
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText("That period is now empty.")).toBeVisible();
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
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText("Couldn't jump to that date.")).toBeVisible();
  await expectNoAxeViolations(page);
});
