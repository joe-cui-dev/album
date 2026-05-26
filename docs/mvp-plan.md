# MVP Implementation Plan

This plan turns the agreed Personal Album scope into implementation phases. The first version optimizes for private access, low idle cost, reliable manual upload of existing photos, and strict isolation between a small set of family Users.

## Product Scope

The MVP is a family allowlist Personal Album service. Each Allowed User signs in with an email Sign-In Code, has exactly one independent Personal Album, performs Manual Upload of Supported Photo Formats, browses their own Timeline, views read-only Photo Metadata, archives photos, retries failed processing, and downloads one Original Photo at a time.

The MVP does not include public registration, shared albums, administrator browsing of other Users' albums, comments, search, tags, folder hierarchy, auto-sync, videos, RAW files, Live Photos, bulk export, PWA/offline mode, cross-region disaster recovery, CI/CD, or separate AWS dev/staging environments.

## Architecture

- Frontend: React, TypeScript, and Vite static SPA.
- Infrastructure: AWS CDK, deployed manually to one production environment.
- Region: `ap-southeast-2`.
- Domain: `album.joe-cui.com` under the existing `joe-cui.com` Route 53 hosted zone.
- API: API Gateway HTTP API backed by plain TypeScript Lambda handlers.
- Auth: Sign-In Code email through Amazon SES for the configured User Allowlist; session stored in an HttpOnly Secure cookie.
- Storage: private S3 bucket for Original Photos and Display Photos.
- Access: API-authorized temporary URLs for Display Access and Original Download.
- Metadata: DynamoDB on-demand.
- Processing: S3 object-created events routed through SQS to a Lambda processor with DLQ.
- Observability: CloudWatch-only minimal logs, alarms, and DLQ monitoring.

## Data Concepts

Core records should represent:

- User record from the configured User Allowlist.
- User session.
- Upload Batch.
- Photo.
- Photo Metadata.
- Processing State.
- Exact Duplicate hash.
- Archived Photo state.

Photo records need enough fields to support Timeline browsing:

- photo id.
- owning User ID.
- original object key.
- display object key.
- file name.
- format.
- file size.
- dimensions.
- SHA-256 hash.
- Captured At.
- Captured At Source.
- Processing State.
- archived flag.
- optional camera, lens, and Location metadata.

Captured At fallback order is:

1. EXIF timestamp.
2. file modified time.
3. upload time.

## API Surface

Initial API endpoints should cover:

- Request Sign-In Code.
- Verify Sign-In Code and set session cookie.
- Get current session.
- Sign out.
- Create Upload Batch and presigned S3 upload URLs.
- Get Upload Batch status.
- List Timeline photos with Timeline Filters.
- Get photo detail.
- Archive photo.
- Retry Processing.
- Create Display Access URL.
- Create Original Download URL.

The API must not proxy Original Photo bytes or Display Photo bytes. API handlers must derive the owning User ID from the authenticated session, never from client-provided user input.

## Implementation Phases

### Phase 1: Repository and CDK Foundation

- Create the TypeScript workspace structure:
  - `apps/web`
  - `apps/api`
  - `infra`
  - `packages/shared`
- Add shared TypeScript config, linting, formatting, and test scripts.
- Create CDK app and production stack.
- Configure account, region, and domain inputs.
- Add `cdk synth` verification.

### Phase 2: Core Infrastructure

- Create private S3 bucket with versioning.
- Add lifecycle cleanup for incomplete multipart uploads.
- Create DynamoDB table with on-demand billing and point-in-time recovery.
- Create SQS processing queue and DLQ.
- Create DNS record for `album.joe-cui.com`.
- Configure temporary S3 object access for browser display and downloads.
- Configure CloudWatch log retention.
- Add AWS Budgets alert and key CloudWatch alarms.

### Phase 3: Authentication

- Implement SES Sign-In Code sender.
- Store one-time codes with expiry.
- Verify code only for emails in the configured User Allowlist.
- Resolve the signed-in email to a stable User ID.
- Set HttpOnly Secure session cookie.
- Add middleware/helper for authenticated Lambda handlers.
- Build sign-in UI in the SPA.

### Phase 4: Upload Batch and Direct Upload

- Implement Create Upload Batch API.
- Generate photo ids and private S3 object keys scoped under the signed-in User ID.
- Accept client SHA-256 pre-hash for early Exact Duplicate checks within the signed-in User's Personal Album.
- Return presigned S3 upload URLs.
- Configure browser direct upload to S3 with CORS.
- Build upload UI with per-photo progress and batch status.

### Phase 5: Photo Processing

- Route S3 object-created events to SQS.
- Implement processor Lambda.
- Resolve the owning User ID from the object key and preserve it on metadata records.
- Compute authoritative SHA-256 from the S3 object.
- Extract Photo Metadata and Captured At.
- Generate one Display Photo at the configured Display Size.
- Write Processing State to DynamoDB.
- Mark failures as Processing Failed without deleting the Original Photo.
- Support Retry Processing.

### Phase 6: Timeline and Photo Detail

- Implement Timeline query by User ID and Captured At.
- Add Timeline Filters for year/month, Processing State, and archived status.
- Build responsive Timeline UI for desktop and Mobile Browsing.
- Build photo detail view with read-only Photo Metadata.
- Add Archive action.
- Add temporary Display Access URL creation.
- Add single-photo Original Download.

### Phase 7: Hardening and Cost Guardrails

- Add Lambda reserved concurrency limits.
- Add upload size limits.
- Add DLQ alarm.
- Add Lambda error and throttle alarms.
- Verify CloudWatch log retention.
- Verify S3 lifecycle rules.
- Verify DynamoDB PITR.
- Smoke test the production deployment.

## Acceptance Checklist

- Allowed Users can sign in with a Sign-In Code sent by SES.
- A non-allowlisted email cannot sign in.
- Each signed-in User sees only their own Personal Album through the shared app entry.
- A signed-in User can upload a batch of JPEG, PNG, and HEIC photos.
- Original Photos upload directly to S3 without passing through API Gateway or Lambda.
- S3 object keys and metadata records include the owning User ID.
- Each uploaded photo eventually becomes ready, Processing Failed, or Exact Duplicate within the owning User's Personal Album.
- Ready photos appear in the signed-in User's Timeline ordered by Captured At.
- A photo without EXIF timestamp still appears using the agreed Captured At fallback order.
- Display Photos are viewable only through temporary Display Access authorized for the signed-in User.
- Original Photos are not public and can only be downloaded through temporary Original Download authorized for the signed-in User.
- Archived Photos are hidden from the default Timeline.
- Processing Failed photos preserve the Original Photo and can be retried.
- Mobile Browsing works for Timeline, detail, and Manual Upload.
- `cdk synth` passes.
- Cost Guardrails are present in CDK.

## ADRs

The implementation should follow these recorded decisions:

- [Use AWS Serverless Infrastructure Managed by CDK](./adr/0001-serverless-aws-cdk.md)
- [Use DynamoDB On-Demand for Photo Metadata](./adr/0002-dynamodb-on-demand-for-photo-metadata.md)
- [Keep Photo Objects Private Behind CloudFront](./adr/0003-private-s3-cloudfront-photo-access.md) (partially superseded by ADR-0011)
- [Upload Original Photos Directly to S3](./adr/0004-s3-direct-upload-for-original-photos.md)
- [Deploy in a Single Sydney Region](./adr/0005-single-region-sydney-deployment.md)
- [Use Protective Retention Without Cross-Region Backup](./adr/0006-protective-retention-without-cross-region-backup.md)
- [Use a React Vite Static SPA](./adr/0007-react-vite-static-spa.md)
- [Use Plain TypeScript Lambda Handlers](./adr/0008-plain-typescript-lambda-handlers.md)
- [Include Cost Guardrails in the First Version](./adr/0009-first-version-cost-guardrails.md)
- [Buffer Photo Processing with SQS](./adr/0010-sqs-buffer-for-photo-processing.md)
- [Use Family Allowlist Users with Session-Scoped Photo Access](./adr/0011-family-allowlist-user-isolation.md)
