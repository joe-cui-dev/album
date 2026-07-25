# MVP Roadmap

This is the living roadmap for Personal Album. It records the intended MVP boundary, what the current code provides, and what still blocks acceptance.

## Status

- The experience foundation, chronology/scale foundation, browsing tracer, and supporting workflows are implemented locally.
- Candidate verification is defined in [the stage 5 execution plan](./refinement-acceptance-execution-plan.md); its performance, production, and assisted gates remain deliberately unclaimed.
- Production smoke testing has not been confirmed, so the MVP is not yet accepted.

Implementation, deployment, and production verification are separate milestones. A feature is only accepted after it works in the production user journey.

## MVP Boundary

The MVP supports a small family User Allowlist. Each Allowed User has one independent Personal Album and can:

- sign in with an emailed Sign-In Code;
- manually upload JPEG, PNG, and HEIC photos;
- see processing progress and retry failures;
- browse Ready Photos in a private Timeline;
- view Photo Metadata;
- adjust and revert Captured At without modifying the Original Photo;
- archive and restore Photos;
- view a Display Photo and download one Original Photo at a time.

The MVP excludes public registration, shared albums, administrator browsing, search, tags, folders, automatic sync, videos, RAW files, Live Photos, bulk export, offline/PWA support, and cross-region disaster recovery.

## Current Architecture

- React and Vite SPA hosted from private S3 through CloudFront.
- API Gateway HTTP API using its default AWS URL.
- Cross-site Session cookie and explicitly allowed SPA origins.
- Plain TypeScript Lambda handlers.
- Private S3 storage with direct browser upload and temporary download URLs.
- DynamoDB on-demand metadata storage.
- S3 events buffered through SQS for Sharp-based photo processing.
- CloudWatch logs and alarms, an SQS dead-letter queue, AWS Budgets, retained buckets, S3 versioning, and DynamoDB point-in-time recovery.
- One manually deployed production environment in `ap-southeast-2`.

Using the default API Gateway URL remains acceptable through MVP acceptance. A same-site `/api/*` route is a possible later simplification, not an MVP blocker.

## Delivered

- Allowlist Sign-In Code flow and signed Session cookies.
- Per-User Personal Album storage boundary.
- Upload Batch creation, direct S3 upload, progress, status, and retry.
- Authoritative duplicate detection from uploaded bytes.
- EXIF extraction with Captured At fallback.
- Display Photo and Timeline Thumbnail generation.
- Timeline API and responsive browsing UI.
- Photo Viewer, Archive/Restore/Undo, temporary Display Access, and Original Download.
- Durable Processing Issues with conditional navigation and Retry Processing.
- Ready-only Timeline/Archive projections without the legacy `uploaded` Processing State.
- Shared photo object-key contracts and storage adapters.
- CDK deployment, frontend hosting, operational logs helper, and automated tests.
- Canonical asynchronous Sign-In, exact-Origin admission, allowlist revalidation, Viewer refinement, chronology editor,
  accessibility/resilience closure, smoke-fixture verifier, and the 20,000-Photo candidate profile harness.

## Remaining Before MVP Acceptance

### Production acceptance

- Pass the automated, performance, assisted-device, and security gates in the [stage 5 execution plan](./refinement-acceptance-execution-plan.md).
- Complete the production smoke test in [deployment.md](./deployment.md) with dedicated Users and versioned non-private fixtures.
- Publish a passing dated record under `docs/acceptance/`, then and only then mark the MVP Accepted.

## After MVP

Potential later work includes a same-site API route, permanent deletion policy, broader backup and recovery, richer browsing, and automated delivery. These are deliberately not designed in detail here.

## Decisions

Long-lived architectural trade-offs are recorded in [docs/adr](./adr/). The domain vocabulary and product meanings live in [CONTEXT.md](../CONTEXT.md).
