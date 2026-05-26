# Personal Album

A private family allowlist photo album built with TypeScript, Node.js, and low-idle-cost AWS serverless services. Each User has one independent Personal Album.

## Workspace

- `apps/web`: React + Vite static SPA.
- `apps/api`: plain TypeScript Lambda handlers.
- `infra`: AWS CDK app.
- `packages/shared`: shared domain and API types.

## First Commands

```sh
npm install
npm run check
cp .env.example .env
npm run cdk:synth
npm run dev:web
```

The target production region is `ap-southeast-2`.

Set local deployment values in `.env` instead of committing them:

```sh
USER_ALLOWLIST=joe:joe@example.com,mum:mum@example.com
BUDGET_ALERT_EMAIL=you@example.com
SESSION_SIGNING_SECRET=replace-with-a-long-random-secret
SES_FROM_EMAIL=you@example.com
ALLOW_DEV_AUTH_CODES=false
ALBUM_DOMAIN=album.example.com
CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/example
HOSTED_ZONE_DOMAIN=example.com
HOSTED_ZONE_ID=Z00000000000000000000
```

You can still override local values for one command with CDK context, for example
`npm run cdk -- deploy -c userAllowlist=joe:joe@example.com,mum:mum@example.com -c sessionSigningSecret=replace-with-a-long-random-secret -c albumDomain=album.example.com`.
