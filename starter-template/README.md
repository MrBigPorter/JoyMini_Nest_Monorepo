# Starter Template Pack

This folder contains reusable scaffolding extracted from this monorepo with business logic removed.

## Included templates

- `nest-auth-prisma/`: NestJS auth baseline with JWT + HttpOnly cookie + Prisma
- `next-ssr-api-client/`: Next.js API client baseline with SSR cookie extraction
- `github-workflows/full_deploy.yml`: Generic GitHub Actions deployment pipeline
- `docker/Dockerfile`: Generic multi-stage Dockerfile for monorepo backend builds

## Placeholder contract

Replace placeholders before use:

- `{{PROJECT_NAME}}`
- `{{PROJECT_SCOPE}}`
- `{{GITHUB_OWNER}}`
- `{{SSH_HOST}}`
- `{{SSH_USERNAME}}`
- `{{VPS_APP_DIR}}`

## Quick start

```bash
cd starter-template/nest-auth-prisma
cp .env.example .env
npm install
npm run prisma:generate
npm run start:dev
```

```bash
cd starter-template/next-ssr-api-client
npm install
```

Use `starter-template/github-workflows/full_deploy.yml` by copying it to your target repo at `.github/workflows/full_deploy.yml` and replacing placeholders.

