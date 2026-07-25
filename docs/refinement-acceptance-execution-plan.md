# Refinement and Acceptance Execution Plan

Status: Approved for implementation, 21 July 2026

> **2026-07-25 supersession note:** Slice 1's v1/v2 dual-contract Auth rollout (retain v1, cut Web to v2, observe 24 hours, then remove v1) is superseded by [ADR-0074](./adr/0074-use-unversioned-canonical-contracts-for-the-first-party-app.md). The pre-MVP cleanup closed the compatibility window in one atomic cutover instead: the asynchronous Sign-In flow is now the sole canonical contract at unversioned routes, with no `/v2` alias or dual-write period. The security behaviours this plan specifies (cooldown, rolling limit, attempt exhaustion, uniform admission/rejection, no sensitive logs) remain the acceptance bar; only the rollout mechanics below are historical.

This plan implements stage 5 of [Personal Light Table Design](./personal-light-table-design.md): the blocking refinement and acceptance gate for the MVP. The design document is the behavioural authority; this plan supplies execution order, code entry points, verification, and rollout checkpoints without restating every interaction rule.

## Start Here

Before editing, read:

1. [Personal Light Table Design](./personal-light-table-design.md), especially Photo Viewer, Chronology, Upload Tray, Interaction and Accessibility, and stage 5.
2. [CONTEXT.md](../CONTEXT.md) for canonical product language.
3. [ADR 0036](./adr/0036-model-captured-at-adjustment-as-a-resource.md), [ADR 0037](./adr/0037-require-optimistic-concurrency-for-captured-at.md), [ADR 0058](./adr/0058-commit-date-jumps-after-anchor-loads.md), [ADR 0059](./adr/0059-use-playwright-for-real-browser-browsing-tests.md), [ADR 0063](./adr/0063-make-contextual-viewer-a-true-modal-layer.md), [ADR 0066](./adr/0066-use-cancellable-typed-album-transport.md), [ADR 0070](./adr/0070-bound-revocation-by-temporary-grant-expiry.md), and [ADR 0071](./adr/0071-dispatch-sign-in-codes-asynchronously.md).

The worktree already contains a user-owned deletion of `docs/supporting-workflows-implementation.md`. Do not restore, stage, or otherwise alter that deletion unless the User explicitly asks.

## Current Baseline

Already implemented:

- private Timeline and Archive Browsing Windows, cursor pagination, date navigation, responsive thumbnails, virtualisation, Viewer routing, and Back restoration;
- Upload Tray, Archive/Restore/Undo, Processing Issues/Retry, Original Download, Session invalidation, and shell-level feedback;
- structured Captured At storage, extraction, ordering, Date Index, adjustment/revert API handlers, ETags, and optimistic concurrency;
- Chromium browser tests, one 320px WebKit smoke, and broad unit/handler coverage.

Known acceptance gaps:

- `PhotoViewerDarkroom.tsx` is Fit-only: no swipe, pinch, pan, Zoom control, idle chrome, Display Access self-recovery, or Photo-change live announcement.
- Viewer Info omits Captured At Source; there is no Adjust/Revert UI.
- `More` declares ARIA menu roles without menu keyboard/focus behaviour.
- Upload Tray declares `aria-modal="true"` despite being non-modal and lacks the agreed focus lifecycle.
- mobile Jump to date declares a modal but does not isolate background, trap/restore focus, handle Escape, retain the sheet while a candidate loads, or cancel on close.
- action-bearing success feedback expires after eight seconds; all feedback is currently polite.
- Exposure amber and several derived CSS colours fail their agreed contrast roles.
- the automated suite has no Firefox/mobile-Chromium projects, axe scans, exhaustive failure matrix, 20,000-Photo measurements, or unified acceptance command.
- protected requests do not revalidate the allowlist or validate Origin.
- Sign-In Code request/verify is synchronous, exposes a public `codeId`, has no attempt/send limits, and has observable allowlist differences.
- production smoke assets, acceptance templates, and dated evidence do not exist.

## Delivery Rules

- Implement the slices below in order. A slice may add failing acceptance tests before its production code, but do not declare the slice complete while its focused tests fail.
- Preserve all domain names from `CONTEXT.md`; do not introduce gallery, asset, owner, unarchive, timestamp, or public-link language.
- Keep deep state machines outside React components. React should render snapshots and forward intents; network, cancellation, race, gesture, and chronology rules belong behind owned modules and ports.
- Use stable machine-readable transport error codes. Components must not branch on human error strings.
- Do not weaken an acceptance threshold to make a test pass. A threshold change requires measurements and an explicit design update.
- Do not deploy, modify the production allowlist, send production mail, or run production smoke merely because this plan mentions those steps. Those external actions require explicit User authorization in the implementation session.
- Finish each slice with its focused checks, then run the broad unit/type suite. Run the full portable acceptance command only after all local slices are green.

## Slice 0 — Acceptance Harness

Goal: make every later defect visible through a stable local gate.

### 0.1 Standard commands and dependencies

Files:

- `package.json`
- `apps/web/package.json`
- `package-lock.json`
- `apps/web/playwright.config.ts`

Tasks:

- Add `@axe-core/playwright` as a Web dev dependency.
- Add root scripts:
  - `test:e2e` — Web Playwright suite;
  - `verify:smoke-fixtures` — fixture manifest/signature/metadata verification;
  - `verify:acceptance` — workspace checks, unit/handler tests, production build, blocking functional Playwright projects, axe states, fixture verification, and CDK synth;
  - `verify:performance` — the separate pinned Chromium measurement profile.
- Configure Playwright projects for desktop Chromium, desktop Firefox, 360px mobile Chromium, and 320px WebKit.
- Keep timing/heap thresholds out of the portable functional projects. The performance project must be selectable independently.
- Retain traces on failure and avoid broad retries that hide races. One CI retry may remain, but the acceptance record must use a clean passing run.

### 0.2 Axe state coverage

Add `apps/web/e2e/accessibility.spec.ts` and reusable helpers under `apps/web/e2e/fixtures/`.

Scan stable states for:

- Sign-In, verification, Session loading, and Session error;
- empty and populated Timeline/Archive;
- Viewer default, Info, More, Adjust, Revert, loading, and scoped error;
- Upload Tray selection, active transfer, minimised, failure, and completion;
- Processing Issues list, retrying, completion empty state, and load failure;
- mobile Jump to date default, pending, empty-period, and retryable failure.

Fail on every real axe violation regardless of impact. Permit only selector-specific false-positive annotations with an adjacent explanation and a matching manual item in the acceptance template. Never disable a rule globally for convenience.

### 0.3 Failure-matrix scaffolding

Extend `apps/web/e2e/fixtures/albumApiMock.ts` so tests can script:

- captured-at PUT/DELETE and 412 responses;
- auth v2 request/verify;
- Display/Thumbnail expiry and recovery;
- delayed responses, cancellation, offline/online, and visibility changes;
- Origin-sensitive API probes where browser automation is appropriate.

Create or extend specs so the six failure families from the design have explicit homes. Each case must assert scope, retained content/anchor, announcement, recovery, and lack of duplicate work.

### 0.4 Acceptance artifact skeleton

Create:

- `docs/acceptance/mvp-acceptance-template.md` — all automated, assisted, performance, security, rollout, and production gates with Pass/Fail/Blocked fields;
- `docs/acceptance/README.md` — evidence redaction rules and dated-record naming.

Do not create a passing dated record yet.

### Slice 0 exit

- TypeScript understands every Playwright project and helper.
- Existing functional tests remain green in their original projects.
- New acceptance tests may expose expected red states, each traceable to a later slice; there are no harness failures unrelated to a known gap.
- The template contains no private test identifiers.

## Slice 1 — Security and Auth v2

Goal: close the three existing security blockers and start the 24-hour compatibility clock.

### 1.1 Exact Origin guard

Likely files:

- new `apps/api/src/origin.ts` and tests;
- `apps/api/src/auth-wrapper.ts`;
- `apps/api/src/handlers/session.ts`;
- mutation handler entry points or one shared handler wrapper;
- `apps/api/src/config.ts`;
- `infra/src/lib/album-stack.ts`.

Implement one injectable Origin policy that:

- parses `Origin` and compares the serialised origin exactly against the production Web origin plus explicit additional development origins;
- rejects missing, `null`, malformed, credential-bearing, path-bearing, suffix, substring, and wildcard candidates;
- protects every API POST/PUT/PATCH/DELETE, including Sign-In request/verify and Sign Out;
- leaves GET/HEAD exempt;
- returns one generic forbidden response before mutation code runs.

Use the same configuration source as API CORS, but do not confuse CORS response headers with mutation admission. Add route-table coverage that fails if a new mutation route is not guarded.

### 1.2 Allowlist revalidation and Removed User

Refactor `createWithAuth` to accept an injectable allowlist resolver in tests and to match both `userId` and normalised Email Address on every protected request. Apply the same check to `GET /session`.

On removal:

- return the shared authentication-loss response;
- clear the Session cookie;
- let the Web's existing global auth-lost path dispose private client state and return to Sign-In;
- issue no new Display, Thumbnail, Original Download, or Upload grants.

Tests must cover removed ID, changed Email for the same ID, changed ID for the same Email, malformed allowlist configuration, and the documented 5-minute read / 15-minute upload residual capability boundary. Do not attempt a presigned-URL revocation registry.

### 1.3 Auth v2 contracts

Add v2 shared request/response types in `packages/shared/src/index.ts`:

- request: Email Address;
- response: `{ accepted: true }` only;
- verify: Email Address + six-digit Code;
- verify response: signed-in User, matching the current Session contract.

Keep v1 types/routes only for the observation window. Name v2 endpoints explicitly in infra and the Web auth adapter rather than changing v1 in place.

### 1.4 Asynchronous dispatch queue and worker

Likely files:

- new `apps/api/src/handlers/dispatch-sign-in-code.ts` and tests;
- new or refactored sign-in admission handler;
- `apps/api/src/store/sign-in-codes.ts` plus DynamoDB/in-memory adapters and concurrency tests;
- `apps/api/src/configured-auth.ts` or a focused auth dependency assembly module;
- `infra/src/lib/album-stack.ts`.

Infrastructure:

- private SQS queue, DLQ, encryption, least-privilege producer/consumer grants, bounded retries, logs, and alarms;
- dedicated worker Lambda;
- route throttles near request 1/s burst 5 and verify 5/s burst 10;
- no plaintext Code in the queue message and no Email/Code/hash in logs.

Worker/state model:

- message carries a random request identity and the normalised Email needed for delivery, but not the Code;
- derive the retry-stable six-digit Code from secret material plus request identity;
- check the allowlist only in the worker;
- non-allowed messages are no-ops with the same public admission path;
- for an Allowed Email, atomically enforce one send per 60 seconds and five in a rolling hour;
- a sent Code replaces the prior active Code, expires in ten minutes, and begins with zero failed attempts;
- redelivery must not consume another rate slot; a rare at-least-once duplicate email must contain the same Code rather than create conflicting credentials.

Verification:

- look up the single active credential by normalised Email, not public code ID;
- treat missing, expired, wrong, exhausted, and non-allowed identically;
- atomically increment wrong attempts up to five;
- atomically consume a correct Code so concurrent success has one winner;
- keep timing-safe hash comparison;
- remove all dev/prod logs that could expose codes or Email Addresses.

### 1.5 Web cutover

Update `apps/web/src/features/auth/SignInForm.tsx`, its API seam, UI messages, and tests:

- call auth v2;
- retain the chosen Email as context;
- verify with Email + Code only;
- show the same accepted and invalid/expired language for all Users;
- keep development-only code display confined to explicit dev mode if the v2 design still needs it; it must never be returned in production.

### 1.6 Rollout checkpoints

Local implementation ends with both v1 and v2 routes available and the Web using v2. Production execution, when separately authorised:

1. deploy queue/worker/v2/Web while retaining v1;
2. run focused v2 smoke and observe for 24 hours;
3. remove v1 request/verify routes in a second candidate/deploy;
4. require stale tabs to refresh;
5. only then run final security acceptance.

### Slice 1 exit

- Origin, allowlist, rate, TTL, attempt, replay, queue retry, and atomic-consume tests pass.
- Public v2 response/error shapes are indistinguishable by membership.
- New Web uses no public code ID.
- CDK synth includes queue, DLQ, worker, route throttles, grants, logs, and alarms.
- v1 removal remains a clearly marked production checkpoint, not an accidental local deletion before the observation deploy.

## Slice 2 — Captured At Completion

Goal: expose the already implemented domain/API capability as a safe, accessible User journey.

### 2.1 Central source labels and viewer data

Add one UI mapping, covered by tests:

- EXIF → `Date from photo`;
- file modified → `Date from file`;
- upload time → `Date from upload`;
- User adjustment → `Adjusted by you`.

Use it in Viewer Info, announcements, adjustment/revert states, and any future chronology surface. Do not duplicate string switches in components.

### 2.2 Chronology editor deep module

Create a focused module under `apps/web/src/features/chronology/` rather than embedding network and draft rules in `PhotoViewerDarkroom.tsx`.

Suggested seams:

- `capturedAtEditor.ts` — state machine for pristine/dirty, validation, saving, conflict, discard confirmation, revert confirmation, and success;
- `capturedAtEditorPort.ts` — PUT adjustment, DELETE revert, and latest chronology reload with AbortSignal;
- `useCapturedAtEditor.ts` — React subscription adapter;
- `CapturedAtEditorDialog.tsx` — accessible form/dialog only;
- test port and unit tests.

Use `chronology.active.revision` to construct `If-Match`. Add a stable `chronology_changed` transport code for 412 rather than reading its message. Keep 428/invalid-body paths as implementation defects, not normal UI branches.

### 2.3 Form semantics

Implement exactly the design contract:

- required Date and Time;
- `Time includes`: Minutes, Seconds, Fractions of a second;
- no invented seconds;
- 1–6 fractional digits with canonical trailing-zero handling;
- optional explicit UTC offset, no browser/location inference;
- existing partial precision leaves unknown fields blank until the User supplies a full replacement;
- first invalid field receives focus and a linked error;
- Save is single-flight and drafts survive network failure.

The first MVP editor authors Date-and-Time precision only. It must not block correct display/order of existing Year/Month/Day values.

### 2.4 Modal and history behaviour

- open from the true More menu;
- make the Viewer inert while the editor owns focus;
- focus Date on open and restore More on success/cancel;
- support Escape and Android/browser Back before Viewer navigation;
- keep the dialog on the same stable Photo route;
- if dirty, replace the dialog body/footer with the in-dialog Discard changes state rather than stacking a modal.

Model the temporary Back entry explicitly and test direct Viewer plus contextual Viewer. Closing the editor must never pop the underlying Viewer route accidentally.

### 2.5 Conflict and revert

On 412:

- preserve the cohesive draft;
- fetch and show latest value/source;
- `Use latest` resets draft and revision;
- `Keep my changes` retains draft and adopts the latest revision;
- never merge individual chronology fields.

Show Revert only for an actual differing User adjustment. Confirmation displays Current, Original, and Original Source at exact precision. Revert has no short Undo.

### 2.6 Propagation after success

Extend the relevant deep-module seams so success:

- refreshes current Viewer bootstrap, neighbours, and exact sequence position;
- invalidates the old chronology placement in retained Timeline/Archive Browsing Windows without forcing an unexpected live jump;
- refreshes Date Index/navigation counts;
- preserves the Viewer Photo while it moves chronologically;
- restores the originating Browsing Window by its stable fallback anchor when Viewer closes.

Prefer a small explicit chronology-changed intent on the existing shell-level mutation/registry boundary over importing Browsing Window internals into the editor.

### Slice 2 exit

- handler/store tests still prove atomic projection/Date Index updates and ETag semantics.
- editor unit tests cover every resolution, offset, dirty exit, network failure, 412 branch, and idempotent Revert.
- browser tests cover every source label, partial display, cross-month/year/Date-unknown movement, stale conflict, Back handling, and focus restoration.

## Slice 3 — Viewer Gestures, Zoom, and Chrome

Goal: finish Photo Viewer behaviour through one testable transform/gesture model.

### 3.1 Pure transform model

Create a pure module such as `apps/web/src/features/viewer/viewerTransform.ts` with tests for:

- intrinsic Photo dimensions and viewport dimensions;
- Fit scale and intrinsic 100% ceiling;
- focal-point preserving scale changes;
- constrained pan per axis;
- viewport resize/orientation preserving intrinsic scale and centre focal point;
- reset to Fit on Photo change;
- no zoom beyond source pixels.

For a Photo whose Fit scale already equals 100%, keep the Zoom control present but disabled with an accessible `Photo is already at 100%` name; do not offer a no-op action.

### 3.2 Pointer gesture controller

Create a controller/module that owns active pointers, capture, thresholds, velocity, gesture cancellation, and mode transitions. Use Pointer Events so touch and test inputs share one path.

Rules:

- one-finger horizontal swipe only at Fit and only from the Photo area;
- horizontal dominance plus 15% viewport / 48px distance, or about 0.5px/ms after 32px;
- left → older/Next, right → newer/Previous;
- sequence edge rebounds without wrap/close;
- above Fit, one finger pans and navigation is disabled;
- two pointers pinch around their midpoint;
- controls/Info/More/editor never begin a Photo gesture;
- failed current image still permits swipe navigation;
- reduced motion removes animated settling but not direct tracking.

Test gesture cancellation, pointer loss, a second pointer arriving mid-drag, navigation while loading, system-edge starts, and mode reset after Photo changes.

### 3.3 Viewer media component

Extract the media stage from `PhotoViewerDarkroom.tsx` so it can:

- reserve dimensions and apply transforms without reflowing chrome;
- provide the 44px Zoom control with `View at 100%` / `Fit to screen` names;
- expose correct cursor/touch-action states;
- perform one automatic bootstrap refresh after a likely expired Display failure, then show scoped Retry;
- keep Previous/Next usable on failure.

### 3.4 Idle chrome

Implement one input-modality-aware timer:

- visible on entry, Photo change, input, focus, menu/info/editor open, and active gesture;
- hide visual chrome after roughly three pointer/touch-idle seconds;
- a non-gesture Photo tap toggles it;
- hidden visual controls receive no pointer input;
- focus/keyboard restores them before use;
- reduced motion switches immediately;
- dispose timers/listeners with the Viewer.

### 3.5 Menu, Info, and announcements

Complete the More menu pattern: open focus, arrows, Home/End, Escape, Tab close-and-continue, outside click, activation close, and no hidden tab stops.

Make Info a named non-modal disclosure with `aria-controls`; keep it open across Photo changes. Escape priority is editor/discard state, More, Info, then Viewer.

Add an atomic polite Photo-change live region containing file name, exact accessible Captured At, and exact sequence position only when reliable. Delay loading announcement by about 500ms; announce failure immediately without moving focus.

### Slice 3 exit

- pure transform and gesture tests cover all bounds and thresholds.
- Chromium/mobile-Chromium browser tests cover swipe, zoom control, menu, announcements, and resize.
- real-device testing is not yet declared complete, but no behaviour depends on synthetic-only touch APIs.

## Slice 4 — Accessibility and Resilience Closure

Goal: eliminate remaining AA, focus, status, contrast, long-text, and access-recovery defects.

### 4.1 Upload Tray semantics and focus

Refactor `UploadTrayPanel.tsx`:

- non-modal named dialog: no `aria-modal`, background inertness, or focus trap;
- programmatically focusable heading on open/restore;
- minimise → focus persistent progress button;
- dismiss → focus global Add photos;
- Escape dismisses pristine/terminal and minimises active work;
- completion navigation lets the destination heading own focus;
- Tab may leave the Tray.

Add batch-level live milestones and file-level failures without percent/poll chatter. Minimise/restore must not replay completed announcements.

### 4.2 Mobile date modal

Refactor `DateNavigation.tsx` and the Browsing Page candidate interface:

- true modal isolation, focus trap, heading focus, Escape/backdrop/Close, and trigger restoration;
- retain sheet during candidate load;
- show and announce pending/empty/failure inside the sheet;
- close only after successful commit and focus the collection heading;
- close cancels the candidate AbortController;
- another desktop/mobile selection cancels the prior candidate.

Preserve ADR 0058: no URL/history entry before the anchor page succeeds.

### 4.3 Feedback timing and status

Change `albumMutations.ts` and `AlbumShell.tsx`:

- auto-dismiss only success without actions;
- keep Undo/Retry/action feedback until action, Dismiss, or replacement;
- success uses polite status, failure uses assertive alert;
- preserve/restore focus when an action replaces or removes its feedback;
- keep errors persistent.

### 4.4 Colour, focus, motion, and long text

Update `apps/web/src/styles.css` and Tailwind classes:

- Exposure amber `#925D1F`;
- muted text at least 66% Album ink;
- required control boundaries at least 52% Album ink;
- solid Emulsion blue focus rings;
- 17% line only for decorative separation;
- disabled semantics not colour-only.

Implement the reduced-motion contract across thumbnails, Darkroom, chrome, sheet, Tray, menu, zoom, and rebounds. Direct manipulation still follows fingers.

Add arbitrary wrapping/full-text access for Viewer Info, Processing Issues, and errors; retain full accessible text where dense UI uses ellipsis. Verify 320px, 200%, and 400% reflow with the agreed Unicode/long fixtures and no page-level two-dimensional scrolling.

### 4.5 Temporary-access recovery

In `browsingWindow.ts`, `TimelineThumbnailImage.tsx`, the Viewer module, and adapters:

- preserve old thumbnail sources while usable;
- batch renew at 100 max, single-flight, inside the 60-second lead;
- use bounded backoff and resume on online/visible/retry-window events;
- local placeholder after actual failure, no per-Photo Retry;
- one automatic current Display bootstrap refresh, then scoped Retry;
- all 401s leave the recovery loop and invalidate Session;
- Original Download always requests fresh access and never auto-repeats a browser download.

### 4.6 Close the failure matrix

Complete deterministic tests for initial, incremental, single-resource, mutation, upload, and race/environment families. Add assertions for announcements and duplicate request/mutation prevention, not just visible copy.

### Slice 4 exit

- every axe state is clean or has a narrowly documented false positive plus manual evidence item;
- keyboard-only journeys pass at 320px and zoom/reflow sizes;
- all agreed failure/access/long-text/reduced-motion browser cases pass in their blocking engines;
- focused manual VoiceOver/TalkBack scripts are ready in the acceptance template.

## Slice 5 — Assets, Scale, and Candidate Acceptance

Goal: create reproducible format evidence, measure the scale target, and prepare the candidate for separately authorised production acceptance.

### 5.1 Production-smoke fixtures

Create a small directory such as `fixtures/production-smoke/` containing:

- generated JPEG with EXIF date/time + explicit offset;
- generated JPEG with EXIF date/time and no offset;
- PNG without EXIF for file-modified fallback;
- genuine HEIC container/encoding;
- deliberately undecodable `.jpg` for the safe Processing Failed path;
- manifest with provenance, expected chronology, media signature, dimensions, metadata expectations, and SHA-256.

Add scripts under `scripts/` to:

- verify signatures, decodability, EXIF expectations, absence of private/GPS/device-identifying metadata, and checksums;
- generate byte-unique run variants while preserving format/metadata semantics;
- set/document the PNG run copy's file-modified time;
- emit hashes for the acceptance record without uploading anything.

If local Sharp cannot encode HEIC, check in one verified generated HEIC produced by a documented toolchain; do not fake it by extension or silently skip verification.

### 5.2 20,000-Photo performance profile

Add a dedicated Chromium spec/config that:

- generates cursor pages totalling 20,000 compact descriptors with mixed ratios, panoramas, partial dates, and long names;
- measures heap growth over signed-in empty baseline using Chromium/CDP with forced collection where supported;
- counts mounted Photo links/images;
- instruments cursor concurrency and renewal batch sizes;
- records relayout + anchor restoration samples under 4x CPU slowdown and calculates p95;
- records application long tasks during scripted scroll;
- snapshots displayed row geometry before/after pagination and decode.

Thresholds are exactly those in the design. Produce machine-readable raw results plus a concise console summary. Warm up, then run three measured iterations; all must pass on the recorded representative machine.

### 5.3 Manual and production runbooks

Update `docs/deployment.md` only after the implemented behaviour matches it:

- remove stale `once implemented` language;
- link fixture verification and acceptance template;
- add auth v2 observation/removal checkpoints;
- add two dedicated smoke Users and privacy rules;
- add Android Chrome, desktop Chrome/Safari, VoiceOver/Safari, and TalkBack/Chrome steps;
- state iOS Safari and Windows NVDA as not production-verified, non-blocking boundaries;
- add safe corrupt-JPEG Retry expectations;
- add User isolation, Origin probe, cooldown, single-use Code, and Removed User steps;
- prohibit recording identifiers, credentials, URLs, or private screenshots.

Refresh `docs/mvp-plan.md` so completed Product consistency items move to Delivered and Remaining points to this plan's actual gates.

### 5.4 Candidate sequence

Local/candidate work:

1. `npm run verify:acceptance` on the exact commit.
2. `npm run verify:performance` three times on the documented machine.
3. assisted keyboard, zoom/reflow, reduced-motion, contrast, VoiceOver, TalkBack, Android gesture, and browser checks.
4. record Pass/Fail/Blocked without claiming production.

External steps, only when separately authorised:

1. deploy the candidate with auth v2 and retained v1;
2. wait/observe 24 hours;
3. deploy v1 removal;
4. rerun focused portable checks against the final commit;
5. run production smoke with two dedicated Users and run-specific fixture hashes;
6. leave the deliberate Processing Issue in the dedicated smoke Album and archive Ready fixtures through the product;
7. create `docs/acceptance/YYYY-MM-DD-mvp.md` from the template;
8. mark `docs/mvp-plan.md` Accepted only when every blocking item passes.

### Slice 5 exit

- both verification commands pass on the final candidate evidence boundary;
- assisted matrices pass with recorded versions;
- auth v1 is absent before final production security smoke;
- real JPEG/PNG/HEIC, Exact Duplicate, safe failure/Retry, Adjust/Revert, Archive/Restore, download, isolation, removal, alarms, and budget notifications pass in production;
- the dated record contains no sensitive information and is the sole authority for Accepted status.

## Required Test Inventory

At minimum, the final suite must include:

- shared chronology: all precision/resolution/offset/source/order/tie/calendar combinations;
- adjustment handler/store: Ready/Archived, ETag, 412/428, idempotent Revert, projection and Date Index transactions;
- chronology editor: validation, draft, dirty Back, network Retry, conflict choices, Revert;
- viewer transform: fit/100%, midpoint zoom, bounds, resize/orientation, small image, reset;
- gesture controller: distance/velocity/dominance, edge, failure, zoom conflict, cancellation;
- Viewer browser: route modes, focus, menu, Info, announcements, idle chrome, failure/recovery, Back;
- Upload Tray: non-modal focus, Escape states, milestones, long names, minimised announcements;
- date modal: focus trap, pending retention, cancel, empty/failure, successful commit;
- feedback: persistent actions, assertive failures, focus after invoke/dismiss;
- Origin: every mutation route plus malformed/similar/missing/null origins;
- allowlist: every ID/Email pair change and cookie clearing;
- auth v2: response equality, no-op, cooldown, rolling limit, attempt exhaustion, expiry, atomic consume, queue redelivery, SES failure, no sensitive logs;
- access: 60-second renewal lead, 100 batch, single-flight/backoff, online/visibility, 401 escape, one Display refresh;
- failure matrix: all six agreed families;
- accessibility: every stable state and manual incomplete finding;
- performance: every numeric design threshold;
- fixture verification: formats, metadata, privacy, hashes, unique variants, deliberate corruption.

## Explicit Non-Goals

Do not add:

- partial-precision authoring UI beyond full Date-and-Time adjustment;
- iOS real-device acceptance or Windows NVDA as a blocker;
- public links, shared Albums, permanent deletion, resumable browser upload, PWA/offline mode, search, tags, folders, bulk actions, or Original Photo editing;
- zoom beyond Display Photo intrinsic pixels, Original Photo auto-fetch, double-tap zoom, inertial pan, or looping Viewer navigation;
- per-Photo thumbnail Retry, background repeated downloads, a revocable presigned-URL registry, raw-IP rate state, or production attack simulation;
- a passing acceptance record before production evidence exists.

## Final Definition of Done

Stage 5 is complete only when:

- every promised behaviour in the accepted design is implemented;
- `npm run verify:acceptance` passes on the final commit;
- `npm run verify:performance` passes three measured runs on recorded hardware;
- WCAG 2.2 AA automated and assisted gates pass;
- Android, VoiceOver, TalkBack, desktop Chrome/Safari, and the non-blocking compatibility boundaries are recorded honestly;
- auth v1 has been removed after its observation window;
- production smoke passes with real non-private fixtures and dedicated Users;
- `docs/acceptance/YYYY-MM-DD-mvp.md` contains only Pass results for blockers;
- `docs/mvp-plan.md` links that record and says Accepted.
