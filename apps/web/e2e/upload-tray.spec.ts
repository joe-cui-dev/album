import {
  buildPhoto,
  collectionPage,
  createUploadBatchResponse,
  emptyNavigation,
  respondJson,
  uploadBatchStatus,
} from "./fixtures/albumApiMock.js";
import { expect, test } from "./fixtures/test.js";

const jpeg = { name: "beach.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-jpeg-bytes") };

test("uploads a photo, survives a route change, and 'View new photos' jumps to its period", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");

  await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
  await page.getByLabel("Choose photos").setInputFiles(jpeg);

  const batch = createUploadBatchResponse(1);
  mock.createUploadBatch.queueOnce((route) => respondJson(route, batch));
  mock.uploadBatchStatus.queueOnce((route) =>
    respondJson(
      route,
      uploadBatchStatus(batch.uploadBatchId, [
        { photoId: batch.uploads[0]!.photoId, fileName: "beach.jpg", processingState: "processing", exactDuplicate: false },
      ]),
    ),
  );

  await page.getByRole("button", { name: "Upload 1 photo" }).click();
  await expect(page.getByText("Processing…")).toBeVisible();

  // Minimizing (and a route change) must not lose the in-progress batch (implementation doc "Upload Tray").
  await page.getByRole("button", { name: "Minimize" }).click();
  await expect(page.getByRole("button", { name: "Show upload progress" })).toBeVisible();

  await page.getByRole("link", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show upload progress" })).toBeVisible();

  await page.getByRole("button", { name: "Show upload progress" }).click();

  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus(batch.uploadBatchId, [
        {
          photoId: batch.uploads[0]!.photoId,
          fileName: "beach.jpg",
          processingState: "ready",
          exactDuplicate: false,
          timelineAnchor: "2025-06",
        },
      ]),
    ),
  );

  await expect(page.getByText("1 added")).toBeVisible({ timeout: 8_000 });

  // The Tray's own probe and the eventual Timeline refetch (after the URL change lands) both
  // hit this endpoint, so this is a `setDefault`, not a `queueOnce`.
  const junePhoto = buildPhoto({ fileName: "beach.jpg", capturedAt: { precision: "day", localDate: "2025-06-15" } });
  mock.timeline.setDefault((route) => respondJson(route, collectionPage([junePhoto])));

  await page.getByRole("button", { name: "View new photos" }).click();

  await expect(page).toHaveURL(/startAt=2025-06/);
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
});

test("recovers an in-progress batch after reload and hides once it settles", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");

  await page.evaluate(() => {
    sessionStorage.setItem(
      "album-upload-tray:user-1",
      JSON.stringify({ uploadBatchId: "batch-recovered", startedAt: Date.now() }),
    );
  });

  // `setDefault`, not `queueOnce`: the recovery fetch and the immediate status poll that
  // follows it both hit this endpoint, and their relative arrival order isn't guaranteed.
  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus("batch-recovered", [
        { photoId: "photo-recovered", fileName: "beach.jpg", processingState: "processing", exactDuplicate: false },
      ]),
    ),
  );

  await page.reload();

  await expect(page.getByRole("button", { name: "Show upload progress" })).toBeVisible();

  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus("batch-recovered", [
        { photoId: "photo-recovered", fileName: "beach.jpg", processingState: "ready", exactDuplicate: false },
      ]),
    ),
  );

  await page.getByRole("button", { name: "Show upload progress" }).click();
  await expect(page.getByText("1 added")).toBeVisible({ timeout: 8_000 });
});
