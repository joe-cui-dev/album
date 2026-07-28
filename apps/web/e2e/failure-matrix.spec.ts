import {
  buildPhoto,
  buildViewerBootstrap,
  collectionPage,
  createUploadBatchResponse,
  emptyNavigation,
  respondAlbumError,
  respondChronologyConflict,
  respondJson,
  thumbnailAccessResponse,
  uploadBatchStatus,
} from "./fixtures/albumApiMock.js";
import { goOnline } from "./fixtures/networkConditions.js";
import { expect, test } from "./fixtures/test.js";

/**
 * Explicit homes for the design's six failure families (execution plan Slice 0.3:
 * "Create or extend specs so the six failure families from the design have explicit
 * homes"; family names per Slice 4.6: initial, incremental, single-resource, mutation,
 * upload, race/environment). Each case below is `test.fixme` until its assertions land in
 * the slice noted, or points at the existing spec that already exercises it -- this file's
 * job is to make the family's presence/absence traceable, not to fabricate a pass.
 *
 * Each landed case must assert scope, retained content/anchor, announcement, recovery, and
 * lack of duplicate work (Slice 0.3), not just visible copy.
 */

test.describe("initial", () => {
  // Covered today: apps/web/e2e/timeline-initial-load.spec.ts ("automatically loads the
  // Timeline without any user action") and apps/web/e2e/accessibility.spec.ts's Sign-In /
  // Session loading / Session error states.
  test.fixme("Session load failure recovers via Return to sign-in without residual state", () => {});
});

test.describe("incremental", () => {
  // Covered today: apps/web/e2e/timeline-initial-load.spec.ts ("recovers from an
  // incremental page-load failure via Retry").
  test.fixme("Trash incremental page-load failure recovers via Retry", () => {});
});

test.describe("single-resource", () => {
  // Covered today: apps/web/e2e/access-failure-recovery.spec.ts (Display Access failure,
  // Thumbnail Access renewal failure).
  test.fixme("Original Download failure shows scoped Retry without affecting the Viewer", () => {});
});

test.describe("mutation", () => {
  // Covered today: apps/web/e2e/trash-mutations.spec.ts, apps/web/e2e/date-jump-navigation.spec.ts
  // (empty-period), apps/web/e2e/processing-issues.spec.ts (retry failure).
  test("Captured At adjustment conflict (412) offers Use latest / Keep my changes", async ({ mock, page }) => {
    mock.viewer.queueOnce((route) =>
      respondJson(route, buildViewerBootstrap({ photoId: "photo-1", fileName: "beach.jpg" })),
    );
    await page.goto("/album/photos/photo-1");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Adjust date and time" }).click();

    const editor = page.getByRole("dialog", { name: "Adjust date and time" });
    await editor.getByLabel("Date").fill("2025-01-09");
    await editor.getByRole("textbox", { name: "Time" }).fill("10:00");

    mock.capturedAtAdjustment.queueOnce((route) => respondChronologyConflict(route));
    // The editor reloads the latest chronology via the viewer bootstrap endpoint on conflict.
    mock.viewer.queueOnce((route) =>
      respondJson(
        route,
        buildViewerBootstrap({
          photoId: "photo-1",
          fileName: "beach.jpg",
          chronology: {
            original: { capturedAt: { precision: "day", localDate: "2025-01-02" }, source: "exif" },
            active: { capturedAt: { precision: "day", localDate: "2025-01-07" }, source: "userAdjusted", revision: 2 },
          },
        }),
      ),
    );
    await page.getByRole("button", { name: "Save" }).click();

    const conflict = page.getByRole("dialog", { name: "Date and time changed" });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByText(/Latest:/)).toContainText("Adjusted by you");

    // "Keep my changes" retains the draft and adopts the latest revision rather than merging fields.
    mock.capturedAtAdjustment.queueOnce((route) =>
      respondJson(route, {
        chronology: {
          original: { capturedAt: { precision: "day", localDate: "2025-01-02" }, source: "exif" },
          active: { capturedAt: { precision: "day", localDate: "2025-01-09" }, source: "userAdjusted", revision: 3 },
        },
      }),
    );
    await page.getByRole("button", { name: "Keep my changes" }).click();
    await expect(page.getByRole("dialog", { name: "Adjust date and time" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Date" })).toHaveValue("2025-01-09");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More" })).toBeFocused();
  });
});

test.describe("upload", () => {
  // Covered today: apps/web/e2e/upload-tray.spec.ts, apps/web/e2e/accessibility.spec.ts's
  // Upload Tray failure/completion states.
  test("A single failed file in a mixed batch keeps the rest of the batch progressing", async ({ mock, page }) => {
    const beach = { name: "beach.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-jpeg-bytes") };
    const cliff = { name: "cliff.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake-jpeg-bytes-2") };
    mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
    await page.goto("/album");
    await page.getByRole("navigation", { name: "Album" }).getByRole("button", { name: "Add photos" }).click();
    await page.getByLabel("Choose photos").setInputFiles([beach, cliff]);

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
            failureCode: "unsupportedImage",
          },
          { photoId: batch.uploads[1]!.photoId, fileName: "cliff.jpg", processingState: "processing", exactDuplicate: false },
        ]),
      ),
    );
    await page.getByRole("button", { name: "Upload 2 photos" }).click();

    // The failed file surfaces its own scoped message without stalling the still-processing one.
    await expect(page.getByText("This file isn't a supported image format.")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Processing…")).toBeVisible();

    mock.uploadBatchStatus.setDefault((route) =>
      respondJson(
        route,
        uploadBatchStatus(batch.uploadBatchId, [
          {
            photoId: batch.uploads[0]!.photoId,
            fileName: "beach.jpg",
            processingState: "processingFailed",
            exactDuplicate: false,
            failureCode: "unsupportedImage",
          },
          { photoId: batch.uploads[1]!.photoId, fileName: "cliff.jpg", processingState: "ready", exactDuplicate: false },
        ]),
      ),
    );

    // The batch completes with the still-processing file added and the earlier failure counted
    // as "needs attention" (routed to Processing Issues) rather than re-attempted or dropped.
    const completion = page.getByRole("dialog", { name: "Add photos" });
    await expect(completion.getByText("1 added")).toBeVisible({ timeout: 8_000 });
    await expect(completion.getByText("1 needs attention")).toBeVisible();
  });
});

test.describe("race/environment", () => {
  // Scaffolding for this family lives in fixtures/networkConditions.ts (goOffline/goOnline,
  // setDocumentVisibility, probeWithOrigin).
  test("Access renewal resumes on an online/visibility event after a bounded backoff", async ({ mock, page }) => {
    const photo = buildPhoto({ fileName: "beach.jpg" });
    mock.timeline.queueOnce((route) =>
      respondJson(route, collectionPage([photo], { expiresAt: new Date(Date.now() + 30_000).toISOString() })),
    );
    mock.navigation.queueOnce((route) => respondJson(route, emptyNavigation()));
    mock.thumbnailAccess.queueOnce((route) => respondAlbumError(route, 500, "unexpected", "Simulated failure"));

    await page.goto("/album");
    const photoLink = page.getByRole("link", { name: /beach\.jpg/ });
    await expect(photoLink).toBeVisible();
    // The failed renewal is silently absorbed into a bounded backoff window, not surfaced as a Grid error.
    await expect(page.getByText("Couldn't load more photos.")).toHaveCount(0);
    await expect(photoLink.locator("img")).toHaveAttribute("src", /^data:image\/png/);

    // A same-origin `online` resume forces past the backoff window and re-issues renewal for the
    // still-visible thumbnails (browsingWindow.ts's `force` demand-call parameter).
    mock.thumbnailAccess.setDefault((route) => respondJson(route, thumbnailAccessResponse([photo.photoId])));
    await goOnline(page);

    await expect(photoLink.locator("img")).toHaveAttribute("src", /^data:image\/png/);
    await expect(page.getByText("Couldn't load more photos.")).toHaveCount(0);
  });

  // "A same-Origin mutation succeeds and a cross-Origin probe is rejected" has no local home:
  // the exact-Origin guard (execution plan Slice 1.1, apps/api/src/origin.ts /
  // mutation-origin-guard.test.ts) runs server-side and is unit-tested there. `probeWithOrigin`
  // in fixtures/networkConditions.ts needs a real deployed API to exercise end-to-end, which is a
  // production smoke step requiring separate authorization (execution plan Slice 5.4), not a
  // portable local browser test -- `AlbumApiMock`'s page-level route interception matches by URL
  // only and cannot validate server-side Origin admission.
  test.fixme("A same-Origin mutation succeeds and a cross-Origin probe is rejected", () => {});
});
