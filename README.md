# Personal Album

A private, single-owner photo album built with TypeScript, Node.js, and low-idle-cost AWS serverless services.

## Workspace

- `apps/web`: React + Vite static SPA.
- `apps/api`: plain TypeScript Lambda handlers.
- `infra`: AWS CDK app.
- `packages/shared`: shared domain and API types.

## First Commands

```sh
npm install
npm run check
npm run cdk:synth
npm run dev:web
```

The target production domain is `album.joe-cui.com` in `ap-southeast-2`.

