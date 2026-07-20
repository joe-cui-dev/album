import { buildPhoto, collectionPage, navigationWithYears, respondJson, respondUnauthorized } from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("returns to Sign-In and drops the signed-in shell when a protected request reports an expired session", async ({
  mock,
  page,
}) => {
  const photo = buildPhoto({ fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) =>
    respondJson(route, navigationWithYears({ timelineYears: [{ year: 2025, counts: { "02": 1 } }] })),
  );

  await page.goto("/album");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();

  // The next Timeline request (fired by the date Jump below) reports the session as expired.
  mock.timeline.queueOnce((route) => respondUnauthorized(route));

  await page.getByRole("button", { name: "Expand 2025" }).click();
  await page.getByRole("button", { name: "February 2025" }).click();

  await expect(page.getByLabel("Email address")).toBeVisible();
  // AlbumShell, and the Browsing Window/history registry it owns, is gone -- not just overlaid by Sign-In.
  await expect(page.getByRole("navigation", { name: "Album" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toHaveCount(0);
});
