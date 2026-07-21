import { test } from "./fixtures/test.js";

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
  test.fixme("Archive incremental page-load failure recovers via Retry", () => {});
});

test.describe("single-resource", () => {
  // Covered today: apps/web/e2e/access-failure-recovery.spec.ts (Display Access failure,
  // Thumbnail Access renewal failure).
  test.fixme("Original Download failure shows scoped Retry without affecting the Viewer", () => {});
});

test.describe("mutation", () => {
  // Covered today: apps/web/e2e/archive-mutations.spec.ts, apps/web/e2e/date-jump-navigation.spec.ts
  // (empty-period), apps/web/e2e/processing-issues.spec.ts (retry failure).
  // Not yet covered: captured-at adjustment/revert 412 conflict (execution plan Slice 2.5) --
  // scaffolded via `mock.capturedAtAdjustment` / `respondChronologyConflict` in albumApiMock.ts,
  // but the Chronology editor UI that would exercise it doesn't exist yet.
  test.fixme("Captured At adjustment conflict (412) offers Use latest / Keep my changes", () => {});
});

test.describe("upload", () => {
  // Covered today: apps/web/e2e/upload-tray.spec.ts, apps/web/e2e/accessibility.spec.ts's
  // Upload Tray failure/completion states.
  test.fixme("A single failed file in a mixed batch keeps the rest of the batch progressing", () => {});
});

test.describe("race/environment", () => {
  // Scaffolding for this family lives in fixtures/networkConditions.ts (goOffline/goOnline,
  // setDocumentVisibility, probeWithOrigin) -- no assertions yet since the access-renewal
  // backoff/online-visibility recovery loop (Slice 4.5) isn't implemented.
  test.fixme("Access renewal resumes on an online/visibility event after a bounded backoff", () => {});
  test.fixme("A same-Origin mutation succeeds and a cross-Origin probe is rejected", () => {});
});
