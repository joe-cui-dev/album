# Personal Album Deployment Handoff

Next session focus: create an implementation checklist for the deployment-prep work, without changing code yet. The user explicitly chose "B" at the end: generate the implementation list first, then start code changes in a later/new session.

## Repo Context

- Workspace: `/Users/xiaozhoucui/repos/album`
- Current project phase: around Phase 5 of `docs/mvp-plan.md`
- Relevant docs:
  - `/Users/xiaozhoucui/repos/album/docs/mvp-plan.md`
  - `/Users/xiaozhoucui/repos/album/docs/phase-5-work-checklist.md`
  - `/Users/xiaozhoucui/repos/album/CONTEXT.md`
  - `/Users/xiaozhoucui/repos/album/docs/adr/0011-family-allowlist-user-isolation.md`
  - `/Users/xiaozhoucui/repos/album/docs/adr/0017-use-default-http-api-url-for-phase-5.md`
- Key code files inspected:
  - `/Users/xiaozhoucui/repos/album/infra/src/lib/album-stack.ts`
  - `/Users/xiaozhoucui/repos/album/infra/src/bin/album.ts`
  - `/Users/xiaozhoucui/repos/album/apps/api/src/auth.ts`
  - `/Users/xiaozhoucui/repos/album/apps/api/src/handlers/process-photo.ts`
  - `/Users/xiaozhoucui/repos/album/apps/web/src/features/upload/UploadPage.tsx`
  - `/Users/xiaozhoucui/repos/album/apps/web/src/features/upload/fileValidation.ts`

## Current Findings

- `album.joe-cui.com` is still wired to a CloudFront distribution for Display Photos in `infra/src/lib/album-stack.ts`, around the existing `DisplayPhotosDistribution`. This conflicts with ADR-0011 and Phase 5 checklist, which say the domain should host the SPA Shared App Entry.
- There is no current deployable web asset bucket/static deployment path for the Vite SPA.
- CDK does not currently output the HTTP API default invoke URL, web bucket name, or CloudFront distribution id for a deploy script.
- `apps/web` already reads `VITE_API_BASE_URL` through `apps/web/src/lib/config.ts`.
- `apps/api/src/auth.ts` currently emits session cookies with `SameSite=Lax`; ADR-0017 requires `SameSite=None; Secure` for the hosted SPA calling the default HTTP API URL cross-site.
- Current CDK CORS origins include both production domain and `http://localhost:5173`; the user chose to make production allow only the production origin by default, with localhost only via explicit config.
- Frontend validates per-file max size and format, but does not appear to enforce max 100 files before calling the API.
- Processor `resolveCapturedAt` currently falls back `fileModifiedAt -> uploadTime`; EXIF timestamp extraction was not observed in the inspected lines. This was noted as a Phase 5 semantic gap, but not necessarily a deployment blocker under the chosen scope.

## Decisions Already Made

The user wants a first cloud deployment that proves a basically running app, including real Allowed User sign-in through SES Sign-In Code.

Deployment strategy:
- Use one AWS production environment only.
- Do not introduce dev/staging for MVP.
- Use a manually triggered, repeatable deploy runbook/script.
- Script should handle mechanical deployment steps; production smoke test remains manual.
- On failure, the deploy script should stop and preserve the current state. No automatic rollback, destroy, or cleanup.

SPA hosting:
- `album.joe-cui.com` must host the SPA before first "basically running" deployment.
- Remove the app-domain Display Photos CloudFront model from Phase 5 infrastructure.
- Do not implement Phase 6 Display Access yet.
- Use a separate web asset bucket for SPA files, not the photos bucket.
- CDK owns web bucket + CloudFront.
- Deploy script builds Vite, syncs assets to the web bucket, and invalidates CloudFront.
- CloudFront SPA fallback should map 403/404 to `/index.html`.
- Use existing externally provided `CERTIFICATE_ARN`, but document that it must be a `us-east-1` ACM cert covering `album.joe-cui.com`.

API URL injection:
- CDK should output the HTTP API default invoke URL.
- Deploy script reads CDK outputs and builds the SPA with `VITE_API_BASE_URL=<apiUrl>`.
- No runtime config JSON for now.

Auth and SES:
- Production smoke must use real SES Sign-In Code.
- `ALLOW_DEV_AUTH_CODES=false` in production.
- SES identity strategy: verify the `joe-cui.com` domain and use a dedicated `SES_FROM_EMAIL` address.
- For first run, SES sandbox is acceptable if all Allowed User recipient emails are verified. Apply for SES production access after first deployment succeeds.
- Do not record specific user email addresses in the handoff; none were provided during the session.

Configuration:
- First deployment can use local environment variables or an uncommitted `.env`.
- Do not commit secrets.
- Required production config variables currently include at least: `CERTIFICATE_ARN`, `USER_ALLOWLIST`, `ALBUM_DOMAIN`, `HOSTED_ZONE_ID`, `HOSTED_ZONE_DOMAIN`, `SESSION_SIGNING_SECRET`, `SES_FROM_EMAIL`, `BUDGET_ALERT_EMAIL`.

Code completion line before first deployment:
- Use the narrowed "A" scope: fix cloud-running blockers and a few trust-breaking Phase 5 gaps, but do not wait for Phase 6.
- Must include SPA hosting, web bucket, CDK outputs, deploy script/runbook, `SameSite=None; Secure`, production CORS/S3 direct upload, real SES login, frontend 100 files/batch validation, and real JPEG/PNG/HEIC smoke testing.
- Do not wait for Timeline/Photo Detail/Display Access/Original Download.

Smoke test data:
- Do not commit photo fixtures to the repo.
- Runbook should instruct the operator to prepare non-private JPEG, PNG, and real HEIC files.
- Keep the test photos in production temporarily under a chosen Allowed User's Personal Album. Do not manually delete S3/DynamoDB test records during first deployment.

Docs:
- Add `docs/deployment.md`.
- Update `docs/phase-5-work-checklist.md` to reflect deployment-prep state.
- Do not update `CONTEXT.md` unless a real domain term is resolved; the deployment decisions are operational, not glossary material.
- No ADR was requested or clearly required yet, because these choices are mostly reversible deployment execution details.

## Requested Next Output

The next agent should produce a concise implementation checklist only. The user selected not to start editing in this session. The checklist should likely be ordered like:

1. Infra changes for SPA hosting and CloudFront.
2. CDK outputs and production CORS config.
3. Auth cookie change.
4. Frontend validation gap.
5. Deploy script.
6. Deployment runbook.
7. Phase 5 checklist updates.
8. Local verification commands.
9. Manual AWS/SES/certificate prerequisites.
10. Manual production smoke test.

Keep the checklist actionable enough that a later coding session can execute it directly.

## Suggested Skills

- `grill-with-docs`: Use if the next agent needs to ask more design questions or reconcile deployment language with existing docs.
- `handoff`: Use again after the implementation checklist is created or after code changes begin, if work needs to move to another session.
- `browser:browser`: Use later after frontend/hosting changes are implemented and a local/hosted target needs visual or interaction verification.
- `diagnose`: Use later if `npm run check`, `npm run cdk:synth`, or deployment/smoke test fails.

## Verification Already Done

No code was changed in this session. The previous session only inspected files and made decisions with the user.
