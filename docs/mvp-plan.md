# MVP Roadmap

This is the living roadmap for Personal Album. It records the intended MVP boundary, what the current code provides, and what still blocks acceptance.

## Status

- Phases 1–5 are implemented.
- Phase 6 core features are implemented and deployed.
- Phase 7 infrastructure guardrails are largely implemented.
- Production smoke testing has not been confirmed, so the MVP is not yet accepted.

Implementation, deployment, and production verification are separate milestones. A feature is only accepted after it works in the production user journey.

## MVP Boundary

The MVP supports a small family User Allowlist. Each Allowed User has one independent Personal Album and can:

- sign in with an emailed Sign-In Code;
- manually upload JPEG, PNG, and HEIC photos;
- see processing progress and retry failures;
- browse Ready Photos in a private Timeline;
- view Photo Metadata;
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
- Photo detail, Archive, temporary Display Access, and Original Download.
- Shared photo object-key contracts and storage adapters.
- CDK deployment, frontend hosting, operational logs helper, and automated tests.

## Remaining Before MVP Acceptance

### Product consistency

- Add Restore Photo so Archive is reversible.
- Add a durable Processing Issues view so failed Photos remain discoverable after refresh or on another device.
- Remove the unused `uploaded` Processing State.
- Keep Timeline limited to Ready Photos and remove non-ready Processing State filters from its API and UI.

### Security

- Revalidate the User Allowlist on protected requests so removing a User revokes existing Sessions.
- Add suitable Sign-In Code abuse controls without exposing allowlist membership.
- Validate the request origin for state-changing browser requests while cross-site Session cookies are in use.

### Production acceptance

- Complete the production smoke test in [deployment.md](./deployment.md).
- Confirm real JPEG, PNG, and HEIC processing.
- Confirm User isolation, mobile browsing, alarms, and budget notifications.

## After MVP

Potential later work includes a same-site API route, permanent deletion policy, broader backup and recovery, richer browsing, and automated delivery. These are deliberately not designed in detail here.

## Decisions

Long-lived architectural trade-offs are recorded in [docs/adr](./adr/). The domain vocabulary and product meanings live in [CONTEXT.md](../CONTEXT.md).
