import {
  buildPhoto,
  buildProcessingIssue,
  buildViewerBootstrap,
  collectionPage,
  createUploadBatchResponse,
  emptyNavigation,
  processingIssuesPage,
  respondAlbumError,
  respondJson,
  signedOutSession,
  uploadBatchStatus,
} from "./fixtures/albumApiMock.js";
import { expectNoAxeViolations } from "./fixtures/axeHelpers.js";
import { expect, test } from "./fixtures/test.js";

/**
 * Axe scans across every stable state in execution-plan Slice 0.2's list that is currently
 * reachable in the app at a desktop viewport. Two states -- Viewer Adjust and Viewer Revert
 * -- have no production UI yet (Slice 2's Chronology editor); they are `test.fixme` here so
 * the gap stays traceable without pretending the scan happened. Mobile "Jump to date"
 * states live in `mobile-accessibility.spec.ts`, which needs a narrower viewport.
 */

const jpeg = { name: "beach.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-jpeg-bytes") };

test("Sign-In renders without axe violations", async ({ mock, page }) => {
  mock.session.setDefault((route) => respondJson(route, signedOutSession()));
  await page.goto("/album");
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Sign-In verification step renders without axe violations", async ({ mock, page }) => {
  mock.session.setDefault((route) => respondJson(route, signedOutSession()));
  await page.goto("/album");
  await page.getByLabel("Email address").fill("joe@example.com");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Session loading renders without axe violations", async ({ mock, page }) => {
  mock.session.setDefault(() => new Promise(() => {})); // never resolves during the scan
  await page.goto("/album");
  await expect(page.getByText("Opening your album")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Session error renders without axe violations", async ({ mock, page }) => {
  mock.session.setDefault((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"));
  await page.goto("/album");
  await expect(page.getByRole("alert")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("empty Timeline renders without axe violations", async ({ mock, page }) => {
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await expect(page.getByRole("heading", { name: "Your album is empty" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("populated Timeline renders without axe violations", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "beach.jpg" });
  mock.timeline.queueOnce((route) => respondJson(route, collectionPage([photo])));
  mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("empty Archive renders without axe violations", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  mock.archive.queueOnce((route) => respondJson(route, collectionPage([])));
  await page.goto("/album/archive");
  await expect(page.getByRole("heading", { name: "Your archive is empty" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("populated Archive renders without axe violations", async ({ mock, page }) => {
  const photo = buildPhoto({ fileName: "beach.jpg" });
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  mock.archive.queueOnce((route) => respondJson(route, collectionPage([photo])));
  await page.goto("/album/archive");
  await expect(page.getByRole("link", { name: /beach\.jpg/ })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Photo Viewer default state renders without axe violations", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );
  await page.goto("/album/photos/photo-1");
  await expect(page.getByRole("img", { name: "beach.jpg" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Photo Viewer Info renders without axe violations", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );
  await page.goto("/album/photos/photo-1");
  await page.getByRole("button", { name: "Info" }).click();
  await expectNoAxeViolations(page);
});

test("Photo Viewer More renders without axe violations", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) =>
    respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
  );
  await page.goto("/album/photos/photo-1");
  await page.getByRole("button", { name: "More" }).click();
  await expectNoAxeViolations(page);
});

// Gap: no Adjust/Revert UI exists yet (execution plan Slice 2 -- Chronology editor).
test.fixme("Photo Viewer Adjust renders without axe violations", async () => {});
test.fixme("Photo Viewer Revert renders without axe violations", async () => {});

test("Photo Viewer loading state renders without axe violations", async ({ mock, page }) => {
  mock.viewer.queueOnce(() => new Promise(() => {})); // never resolves during the scan
  await page.goto("/album/photos/photo-1");
  await expectNoAxeViolations(page);
});

test("Photo Viewer scoped error renders without axe violations", async ({ mock, page }) => {
  mock.viewer.queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"));
  await page.goto("/album/photos/photo-1");
  await expect(page.getByText("Couldn't load this photo.")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Upload Tray selection renders without axe violations", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
  await page.getByLabel("Choose photos").setInputFiles(jpeg);
  await expect(page.getByRole("button", { name: "Upload 1 photo" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Upload Tray active transfer renders without axe violations", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
  await page.getByLabel("Choose photos").setInputFiles(jpeg);

  const batch = createUploadBatchResponse(1);
  mock.createUploadBatch.queueOnce((route) => respondJson(route, batch));
  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus(batch.uploadBatchId, [
        { photoId: batch.uploads[0]!.photoId, fileName: "beach.jpg", processingState: "processing", exactDuplicate: false },
      ]),
    ),
  );
  await page.getByRole("button", { name: "Upload 1 photo" }).click();
  await expect(page.getByText("Processing…")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Upload Tray minimised renders without axe violations", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
  await page.getByLabel("Choose photos").setInputFiles(jpeg);

  const batch = createUploadBatchResponse(1);
  mock.createUploadBatch.queueOnce((route) => respondJson(route, batch));
  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus(batch.uploadBatchId, [
        { photoId: batch.uploads[0]!.photoId, fileName: "beach.jpg", processingState: "processing", exactDuplicate: false },
      ]),
    ),
  );
  await page.getByRole("button", { name: "Upload 1 photo" }).click();
  await page.getByRole("button", { name: "Minimize" }).click();
  await expect(page.getByRole("button", { name: "Show upload progress" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Upload Tray per-file failure renders without axe violations", async ({ mock, page }) => {
  // Two files, one still processing: the batch stays non-terminal so the active
  // TransferList (not the terminal CompletionSummary) renders the failure inline.
  const jpeg2 = { name: "cliff.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-jpeg-bytes-2") };
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
  await page.getByLabel("Choose photos").setInputFiles([jpeg, jpeg2]);

  const batch = createUploadBatchResponse(2);
  mock.createUploadBatch.queueOnce((route) => respondJson(route, batch));
  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus(batch.uploadBatchId, [
        {
          photoId: batch.uploads[0]!.photoId,
          fileName: "beach.jpg",
          processingState: "processingFailed",
          exactDuplicate: false,
          failureMessage: "This file isn't a supported image format.",
        },
        { photoId: batch.uploads[1]!.photoId, fileName: "cliff.jpg", processingState: "processing", exactDuplicate: false },
      ]),
    ),
  );
  await page.getByRole("button", { name: "Upload 2 photos" }).click();
  await expect(page.getByText("This file isn't a supported image format.")).toBeVisible({ timeout: 8_000 });
  await expectNoAxeViolations(page);
});

test("Upload Tray completion renders without axe violations", async ({ mock, page }) => {
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
  await page.getByLabel("Choose photos").setInputFiles(jpeg);

  const batch = createUploadBatchResponse(1);
  mock.createUploadBatch.queueOnce((route) => respondJson(route, batch));
  mock.uploadBatchStatus.setDefault((route) =>
    respondJson(
      route,
      uploadBatchStatus(batch.uploadBatchId, [
        { photoId: batch.uploads[0]!.photoId, fileName: "beach.jpg", processingState: "ready", exactDuplicate: false },
      ]),
    ),
  );
  await page.getByRole("button", { name: "Upload 1 photo" }).click();
  await expect(page.getByRole("dialog", { name: "Add photos" }).getByText("1 added")).toBeVisible({ timeout: 8_000 });
  await expectNoAxeViolations(page);
});

test("Processing Issues list renders without axe violations", async ({ mock, page }) => {
  const issue = buildProcessingIssue({ photoId: "photo-1", fileName: "beach.jpg", reasonCode: "unsupportedImage" });
  mock.processingIssuesSummary.setDefault((route) => respondJson(route, { openCount: 1 }));
  mock.processingIssues.setDefault((route) => respondJson(route, processingIssuesPage([issue])));
  await page.goto("/album/processing-issues");
  await expect(page.getByText("beach.jpg")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Processing Issues retrying state renders without axe violations", async ({ mock, page }) => {
  const issue = buildProcessingIssue({ photoId: "photo-1", fileName: "beach.jpg", reasonCode: "unsupportedImage" });
  mock.processingIssuesSummary.setDefault((route) => respondJson(route, { openCount: 1 }));
  mock.processingIssues.queueOnce((route) => respondJson(route, processingIssuesPage([issue])));
  await page.goto("/album/processing-issues");
  mock.retryProcessing.queueOnce((route) => respondJson(route, { accepted: true, retryAttemptId: "retry-1" }));
  mock.processingIssues.setDefault((route) =>
    respondJson(route, processingIssuesPage([{ ...issue, status: "retrying" }])),
  );
  await page.getByRole("button", { name: "Retry processing" }).click();
  await expect(page.getByRole("button", { name: "Retrying…" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Processing Issues completion empty state renders without axe violations", async ({ mock, page }) => {
  mock.processingIssuesSummary.setDefault((route) => respondJson(route, { openCount: 0 }));
  mock.processingIssues.setDefault((route) => respondJson(route, processingIssuesPage([])));
  await page.goto("/album/processing-issues");
  await expect(page.getByText("No processing issues")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("Processing Issues load failure renders without axe violations", async ({ mock, page }) => {
  mock.processingIssuesSummary.setDefault((route) => respondJson(route, { openCount: 1 }));
  mock.processingIssues.setDefault((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"));
  await page.goto("/album/processing-issues");
  await expect(page.getByText("Couldn't load processing issues — try again")).toBeVisible();
  await expectNoAxeViolations(page);
});
