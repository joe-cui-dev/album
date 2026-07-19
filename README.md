# Personal Album

A private photo album for a small family allowlist. Each User signs in by email and has one independent Personal Album.

## Current Status

The AWS production stack is deployed. Authentication, direct upload, photo processing, Timeline browsing, photo detail, archive, temporary Display Access, and Original Download are implemented.

The MVP is not yet accepted. Production smoke testing and a small set of product and security gaps remain; see the [MVP roadmap](./docs/mvp-plan.md).

## Workspace

- `apps/web` — React and Vite SPA.
- `apps/api` — TypeScript Lambda handlers and storage adapters.
- `infra` — AWS CDK production stack.
- `packages/shared` — shared API types and photo object-key contracts.

## Local Development

Node.js 22 or newer is required.

```sh
npm install
npm run check
npm test
npm run dev:web
```

Copy `.env.example` to `.env` for local configuration. Secrets and real user addresses must not be committed.

## Deployment

```sh
npm run cdk:synth
npm run deploy
```

Deployment prerequisites, configuration, smoke tests, logs, and data-reset guidance are in [docs/deployment.md](./docs/deployment.md).

## Project Documentation

- [Domain language](./CONTEXT.md)
- [MVP roadmap](./docs/mvp-plan.md)
- [Deployment runbook](./docs/deployment.md)
- [Phase 5 processing record](./docs/phase-5-work-checklist.md)
- [Architecture decisions](./docs/adr/)
