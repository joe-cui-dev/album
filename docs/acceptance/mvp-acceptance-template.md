# MVP Acceptance Record — TEMPLATE

Do not fill in this file directly. Copy it to `YYYY-MM-DD-mvp.md` (see
[README.md](./README.md)) once every blocking item below has been verified.

- **Candidate commit:** _(full SHA)_
- **Evaluation dates:** _(start – finish, YYYY-MM-DD)_
- **Evaluator(s):** _(name/role, not email)_

All rows are blocking unless marked *(non-blocking)*. Status is Pass, Fail, or Blocked.

## 1. Automated

| Item | Status | Evidence |
| --- | --- | --- |
| `npm run verify:acceptance` passes on the candidate commit | | |
| Workspace `check` (TypeScript) passes across all workspaces | | |
| Unit/handler test suites pass across all workspaces | | |
| Production build succeeds | | |
| Blocking functional Playwright projects (desktop Chromium, desktop Firefox, 360px mobile Chromium, 320px WebKit) pass, no unexplained skips | | |
| Fixture verification (`verify:smoke-fixtures`) passes | | |
| CDK synth succeeds | | |

## 2. Accessibility — automated (axe)

| Item | Status | Evidence |
| --- | --- | --- |
| Every stable state in the axe scan list is clean of real violations | | |
| Every documented false-positive annotation names its rule + selector + reason | | |
| Each false-positive annotation has a matching manual item below | | |

## 3. Accessibility — assisted (manual)

| Item | Status | Evidence |
| --- | --- | --- |
| Keyboard-only journey at 320px viewport | | |
| Keyboard-only journey at 200% zoom / reflow | | |
| Keyboard-only journey at 400% zoom / reflow | | |
| Reduced-motion journey (thumbnails, Darkroom, chrome, sheet, Tray, menu, zoom, rebounds) | | |
| Contrast spot-check against the agreed colour roles | | |
| VoiceOver / Safari focused script | | |
| TalkBack / Chrome focused script | | |
| Android Chrome gesture script (swipe, pinch, pan) | | |
| iOS Safari — recorded as a non-blocking compatibility boundary *(non-blocking)* | | |
| Windows NVDA — recorded as a non-blocking compatibility boundary *(non-blocking)* | | |

## 4. Performance

| Item | Status | Evidence |
| --- | --- | --- |
| `npm run verify:performance` — measured run 1 of 3 | | |
| `npm run verify:performance` — measured run 2 of 3 | | |
| `npm run verify:performance` — measured run 3 of 3 | | |
| Heap growth over signed-in empty baseline within design threshold | | |
| Mounted Photo link/image count within design threshold | | |
| Cursor concurrency / renewal batch sizes within design threshold | | |
| Relayout + anchor restoration p95 (4x CPU slowdown) within design threshold | | |
| Application long tasks during scripted scroll within design threshold | | |
| Recorded machine/hardware for this run | | |

## 5. Security

| Item | Status | Evidence |
| --- | --- | --- |
| Exact-Origin guard rejects missing/null/malformed/credential-bearing/path-bearing/suffix/substring/wildcard Origins on every mutation route | | |
| Allowlist revalidated on every protected request (removed ID, changed Email for same ID, changed ID for same Email, malformed config) | | |
| `GET /session` re-validates the allowlist | | |
| Auth v2 request/verify response shapes are indistinguishable by allowlist membership | | |
| Sign-in code cooldown (60s) and rolling limit (5/hour) enforced | | |
| Sign-in code attempt exhaustion (5 wrong attempts) enforced | | |
| Sign-in code expiry (10 minutes) enforced | | |
| Redelivered dispatch message does not consume another rate slot and returns the same Code | | |
| Concurrent correct-Code verification has exactly one winner | | |
| No Email, Code, or hash appears in logs (dev or prod) | | |
| Public verify response carries no public code ID | | |

## 6. Rollout checkpoints — production (require separate User authorization)

| Item | Status | Evidence |
| --- | --- | --- |
| Deploy queue/worker/v2/Web while retaining v1 | Blocked | Requires separate production authorization |
| Focused v2 smoke passes post-deploy | Blocked | Requires separate production authorization |
| 24-hour v2 observation window completed with no regression | Blocked | Requires separate production authorization |
| v1 request/verify routes removed in a second deploy | Blocked | Requires separate production authorization |
| Stale tabs required to refresh confirmed | Blocked | Requires separate production authorization |

## 7. Production smoke (require separate User authorization)

| Item | Status | Evidence |
| --- | --- | --- |
| Real JPEG (EXIF + offset) fixture processes correctly | Blocked | Requires separate production authorization |
| Real JPEG (EXIF, no offset) fixture processes correctly | Blocked | Requires separate production authorization |
| Real PNG (file-modified fallback) fixture processes correctly | Blocked | Requires separate production authorization |
| Real HEIC fixture processes correctly | Blocked | Requires separate production authorization |
| Exact Duplicate detection | Blocked | Requires separate production authorization |
| Deliberately undecodable file takes the safe Processing Failed / Retry path | Blocked | Requires separate production authorization |
| Adjust/Revert Captured At | Blocked | Requires separate production authorization |
| Archive/Restore | Blocked | Requires separate production authorization |
| Original Download | Blocked | Requires separate production authorization |
| Two dedicated smoke Users see isolated data from each other | Blocked | Requires separate production authorization |
| Origin probe rejected in production | Blocked | Requires separate production authorization |
| Removed-User access loss confirmed in production | Blocked | Requires separate production authorization |
| Alarms and budget notifications confirmed wired | Blocked | Requires separate production authorization |

## Final status

- [ ] Every blocking item above is Pass.
- [ ] `docs/mvp-plan.md` links this record and says Accepted.

**Overall: NOT ACCEPTED** _(flip only when both boxes above are checked)_
