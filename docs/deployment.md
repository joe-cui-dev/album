# Deployment

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
