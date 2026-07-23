import {
  buildProcessingIssue,
  processingIssuesPage,
  respondAlbumError,
  respondJson,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

test("the nav entry appears when issues are open, retrying resolves the issue, and the entry survives leaving the view", async ({
  mock,
  page,
}) => {
  mock.processingIssuesSummary.queueOnce((route) => respondJson(route, { openCount: 1 }));

  await page.goto("/album");

  const navIssuesLink = page.getByRole("link", { name: /Needs attention/ });
  await expect(navIssuesLink).toBeVisible();
  await expect(navIssuesLink).toContainText("1");

  const issue = buildProcessingIssue({ photoId: "photo-1", fileName: "beach.jpg", reasonCode: "unsupportedImage" });
  mock.processingIssues.queueOnce((route) => respondJson(route, processingIssuesPage([issue])));
  // The view itself refreshes the nav count on load too; still 1 open at this point.
  mock.processingIssuesSummary.queueOnce((route) => respondJson(route, { openCount: 1 }));

  await navIssuesLink.click();
  await expect(page.getByRole("heading", { name: "Processing issues" })).toBeVisible();
  await expect(page.getByText("beach.jpg")).toBeVisible();
  await expect(page.getByText("This file isn't a supported image format.")).toBeVisible();

  // Retry marks the issue `retrying`; the view starts polling and picks that up.
  mock.retryProcessing.queueOnce((route) => respondJson(route, { accepted: true, retryAttemptId: "retry-1" }));
  mock.processingIssues.queueOnce((route) =>
    respondJson(route, processingIssuesPage([{ ...issue, status: "retrying" }])),
  );
  await page.getByRole("button", { name: "Retry processing" }).click();
  await expect(page.getByRole("button", { name: "Retrying…" })).toBeVisible();

  // The retry resolves: the issue leaves the list, the view shows the completion empty state,
  // and the nav count refreshes down to zero -- but the entry stays visible while standing on the view.
  mock.processingIssues.setDefault((route) => respondJson(route, processingIssuesPage([])));
  mock.processingIssuesSummary.setDefault((route) => respondJson(route, { openCount: 0 }));

  await expect(page.getByText("No processing issues")).toBeVisible({ timeout: 8_000 });
  await expect(navIssuesLink).toBeVisible();

  // Leaving the view drops the destination once the nav count has caught up (implementation doc "Navigation count").
  await page.getByRole("link", { name: "Album home" }).click();
  await expect(page.getByRole("link", { name: /Needs attention/ })).toHaveCount(0);
});

test("a retry failure shows a persistent error naming the retry action, without leaving the issue stuck as retrying", async ({
  mock,
  page,
}) => {
  mock.processingIssuesSummary.queueOnce((route) => respondJson(route, { openCount: 1 }));
  await page.goto("/album");

  const issue = buildProcessingIssue({ photoId: "photo-1", fileName: "beach.jpg" });
  mock.processingIssues.queueOnce((route) => respondJson(route, processingIssuesPage([issue])));
  mock.processingIssuesSummary.queueOnce((route) => respondJson(route, { openCount: 1 }));
  await page.getByRole("link", { name: /Needs attention/ }).click();
  await expect(page.getByText("beach.jpg")).toBeVisible();

  mock.retryProcessing.queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Internal error"));
  await page.getByRole("button", { name: "Retry processing" }).click();

  await expect(page.getByRole("alert")).toContainText(/couldn't start retry processing/i);
});
