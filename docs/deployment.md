# Deployment

## Phase 2 migration and rollback

Phase 2 is an expand/backfill rollout. The v1 Timeline reader and the legacy
flat chronology fields remain in place throughout this procedure. Do not delete
Timeline items, Original Photos, Display Photos, or compatibility fields as
part of a migration run.

After deploying the Phase 2 stack, obtain the `PhotoMaintenanceCoordinatorName`
and `Phase2ReconciliationName` CloudFormation outputs. First create and retain
a dry-run manifest (it performs no writes):

```sh
aws lambda invoke --function-name "$PHOTO_MAINTENANCE_COORDINATOR" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"dryRun":true,"migrationVersion":1}' phase2-dry-run.json
```

Review `phase2-dry-run.json`; it records the migration version, the explicit
`Australia/Brisbane` legacy fallback zone, selected Ready/failed counts, and
the exact work count. Start the backfill only after approval, retaining the
result as the production migration manifest:

```sh
aws lambda invoke --function-name "$PHOTO_MAINTENANCE_COORDINATOR" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"migrationVersion":1}' phase2-backfill-manifest.json
```

The isolated maintenance worker consumes one message at a time with reserved
concurrency two. It is safe to rerun the coordinator after an S3-only write,
transaction conflict, timeout, or DLQ repair: fixed thumbnail keys and the
migration version make work idempotent. Monitor the Photo Maintenance queue,
its DLQ, and the corresponding Lambda alarms until the queue and DLQ are empty.

Run the read-only reconciliation after the queue drains and retain its output:

```sh
aws lambda invoke --function-name "$PHASE2_RECONCILIATION" \
  --cli-binary-format raw-in-base64-out --payload '{}' phase2-reconciliation.json
```

The report must contain no discrepancies before Phase 3 starts. It checks v2
Ready state, one-projection membership, Date Index totals, durable Processing
Issues, their summary count, and unexpected legacy `uploaded` state. Investigate
and rerun targeted maintenance work for every reported discrepancy; no command
in this runbook performs implicit destructive cleanup.

Rollback before Phase 3 means returning Web traffic to the retained v1 Timeline
reader. Stop new coordinator invocations, let in-flight maintenance messages
finish or remain safely queued, and leave all v2 fields/projections intact for
later reconciliation. New uploads continue to write the compatibility fields,
so this rollback does not replace Originals, Displays, or capture chronology.

Personal Album uses one manually deployed production environment.

## Production Shape

- Region: `ap-southeast-2`.
- Web: `https://album.joe-cui.com`, served from private S3 through CloudFront.
- API: the API Gateway default invoke URL supplied to Vite as `VITE_API_BASE_URL`.
- Photos: private S3 objects accessed through short-lived URLs authorized by the API.
- Authentication: SES Sign-In Codes and a cross-site Secure, HttpOnly Session cookie.

## Prerequisites

- Node.js 22 or newer and configured AWS credentials.
- The Route 53 hosted zone for the app domain.
- A `us-east-1` ACM certificate covering the CloudFront app domain.
- A verified SES sender identity; SES sandbox recipients must also be verified.
- Non-private JPEG, PNG, and real HEIC files for smoke testing.

## Configuration

Copy `.env.example` to `.env` and provide real production values. Do not commit `.env`, secrets, or family email addresses.

The deployment needs the User Allowlist, app and hosted-zone details, certificate ARN, Session signing secret, SES sender, budget email, AWS region, and the current API URL. `ADDITIONAL_WEB_ORIGINS` should normally remain empty in production; add a local origin only when intentionally testing the cloud API from a local browser.

## Deploy

```sh
npm run deploy
```

The script loads `.env`, runs workspace checks, builds the SPA and CDK app, and deploys `PersonalAlbumStack`. CDK uploads the frontend assets and invalidates CloudFront when they change. The script stops on failure and does not destroy or clean up existing resources.

Useful verification commands:

```sh
npm run check --workspaces --if-present
npm test
npm run cdk:synth
```

## Production Smoke Test

The MVP is not accepted until this journey succeeds in production:

1. Sign in as an Allowed User using a real SES Sign-In Code.
2. Refresh the page and confirm the Session remains valid.
3. Upload representative JPEG, PNG, and real HEIC files.
4. Confirm each becomes Ready and appears in the Timeline with a thumbnail.
5. Confirm Captured At and Photo Metadata are sensible.
6. Open a Display Photo and download its Original Photo.
7. Upload an Exact Duplicate and confirm it is reported without entering the Timeline.
8. Exercise Processing Failed and Retry Processing with a safe test case.
9. Archive and, once implemented, restore a Photo.
10. Confirm another User cannot access the first User's Photos.
11. Check the main journey on a phone browser.
12. Confirm alarms and budget notification subscriptions are active.

Use non-private smoke-test photos and manage them through product behavior rather than manually editing S3 or DynamoDB records.

## Logs

```sh
npm run logs
npm run logs -- --since 1h --contains "AccessDenied"
npm run logs -- --request-id abc-123
npm run logs:tail
npm run logs:groups
```

The helper loads `.env` and discovers Lambda log groups from `PersonalAlbumStack`. Use its profile, region, and stack options when overriding defaults.

## Data Reset

The reset helper can empty stack data resources and is destructive. Inspect its scope before use:

```sh
npm run reset:data -- --dry-run
```

Do not run a confirmed reset against production unless deleting that data is explicitly intended. Web assets and logs require separate opt-in flags.
