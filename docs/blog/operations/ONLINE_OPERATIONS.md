# Online Operations Runbook

> **Purpose**: Centralized reference for operating the Lucky Nest Monorepo in production.
> **Audience**: Developers who need to deploy code, run seeds, or diagnose issues on the production server.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [CI/CD Deployment Flow](#2-cicd-deployment-flow)
3. [Seed Script Management](#3-seed-script-management)
4. [Running Seeds on Production](#4-running-seeds-on-production)
5. [Verifying Data](#5-verifying-data)
6. [Common Operations](#6-common-operations)
7. [Troubleshooting](#7-troubleshooting)
8. [Reference](#8-reference)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Repository                      │
│  JoyMini_Nest_Monorepo (main/test branches)              │
└──────────────┬──────────────────────────────────────────┘
               │ git push
               ▼
┌──────────────────────────────┐    ┌──────────────────────┐
│  GitHub Actions              │    │  Cloudflare Pages    │
│  deploy-backend.yml          │    │  (Blog Frontend)     │
│  ─ Build Docker image        │    │  deploy-blog-        │
│  ─ Push to GHCR              │    │  cloudflare.yml      │
│  ─ SSH to VPS                │    │                      │
│  ─ Pull image + migrate      │    │  (Separate deploy    │
│  ─ Restart container         │    │   flow, not covered  │
└──────────────┬───────────────┘    │   here)              │
               │                    └──────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────┐
│                    VPS Server                             │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Docker Container: lucky-backend-prod             │   │
│  │  ├─ NestJS API (port 3000)                       │   │
│  │  ├─ Compiled seed scripts: dist/cli/seed/*.js    │   │
│  │  └─ Prisma Client                                │   │
│  ├── lucky-db-prod (PostgreSQL)                      │   │
│  ├── lucky-redis-prod (Redis)                        │   │
│  └── lucky-nginx-prod (reverse proxy, port 443)      │   │
└─────────────────────────────────────────────────────────┘
```

### Key URLs

| Service | URL |
|---------|-----|
| API Health | `https://api.joyminis.com/api/v1/health` |
| Blog Categories API | `https://api.joyminis.com/api/v1/blog/categories` |
| Blog Tags API | `https://api.joyminis.com/api/v1/blog/tags` |
| Blog Articles API | `https://api.joyminis.com/api/v1/blog/articles` |

---

## 2. CI/CD Deployment Flow

### Trigger Conditions

The backend deployment ([`.github/workflows/deploy-backend.yml`](../../../.github/workflows/deploy-backend.yml)) auto-triggers on push to `main` or `test` branches when any of these paths change:

```
apps/api/**
packages/shared/**
packages/config/**
Dockerfile.prod
compose.prod.yml
nginx/nginx.prod.conf
nginx/whitelist.conf
.github/workflows/deploy-backend.yml
```

### Deployment Pipeline Steps

| Step | What Happens |
|------|-------------|
| **1. Quality Gate** | Lint + TypeScript check. If fails, pipeline stops. |
| **2. Build Image** | Docker build using `Dockerfile.prod` — includes `tsc -p apps/api/tsconfig.cli.json` to compile seed scripts into `dist/cli/` |
| **3. Push to GHCR** | Image pushed to `ghcr.io/mrbigporter/lucky-backend-prod:latest` |
| **4. SSH Deploy** | Pulls new image on VPS → runs `prisma migrate deploy` → restarts `lucky-backend-prod` container |
| **5. Health Check** | Waits up to 90s for health endpoint. On failure: auto-rollback to previous image. |
| **6. Notification** | Telegram message with deploy status. |

### Manual Trigger

You can also manually trigger from GitHub Actions UI:
1. Go to `Actions` → `Deploy Backend`
2. Click `Run workflow`
3. Select branch and runner

---

## 3. Seed Script Management

### Seed Script Inventory

| Script | Location | Purpose | Production Safe? |
|--------|----------|---------|-----------------|
| `seed-blog-categories-tags.ts` | [`apps/api/scripts/seed/seed-blog-categories-tags.ts`](../../../apps/api/scripts/seed/seed-blog-categories-tags.ts) | Insert 6 categories + 27 tags | ✅ Yes (idempotent, no delete) |
| `seed-blog.ts` | [`apps/api/scripts/seed/seed-blog.ts`](../../../apps/api/scripts/seed/seed-blog.ts) | **FULL RESET** — deletes all blog data, re-imports 6 demo articles | ❌ **No** (runs deleteMany) |
| `seed-banners.ts` | [`apps/api/scripts/seed/seed-banners.ts`](../../../apps/api/scripts/seed/seed-banners.ts) | Insert home page banners | Varies |
| `seed-treasures.ts` | [`apps/api/scripts/seed/seed-treasures.ts`](../../../apps/api/scripts/seed/seed-treasures.ts) | Insert product data | Varies |
| Other seed scripts | `apps/api/scripts/seed/*.ts` | Various data initialization | Check each script |

### Safety Rules

1. **NEVER** run `seed-blog.ts` on production — it calls `deleteMany()` on all blog tables
2. **ALWAYS** check a seed script for `deleteMany`/`deleteMany()` before running on production
3. **PREFER** idempotent scripts that skip existing records (check by unique slug)
4. **KNOW** that compiled seed scripts live at `dist/cli/seed/*.js` in the Docker image (TypeScript strips the `scripts/` prefix)
5. **REMEMBER** that `tsconfig.cli.json` must include any script's dependencies (like `scripts/utils/`) to compile correctly

### Managing New Seed Scripts

When adding a new seed script:

```
flowchart LR
    A[Create .ts file] --> B[Update package.json script]
    B --> C{Needs utils?}
    C -->|Yes| D[Add to tsconfig.cli.json include]
    C -->|No| E[Skip tsconfig change]
    D --> F[Commit + Push to GitHub]
    E --> F
    F --> G[CI builds Docker image]
    G --> H[SSH exec compiled .js in container]
```

**Critical Path Discovery**: When we added `seed-blog-categories-tags.ts`, we discovered that `tsconfig.cli.json`'s `include` array didn't include `scripts/utils/`, which meant `load-env-for-host.ts` wasn't compiled. The fix was adding `"scripts/utils/**/*.ts"` to `include` in [`tsconfig.cli.json`](../../../apps/api/tsconfig.cli.json).

---

## 4. Running Seeds on Production

### Prerequisites

- Latest Docker image deployed (seed scripts are compiled inside it)
- SSH access to VPS (or GitHub Actions runner can execute commands)

### Run Blog Categories & Tags Seed

```bash
# Step 1: SSH into VPS
ssh user@your-server

# Step 2: Execute the compiled seed script inside the running container
docker exec lucky-backend-prod node /app/apps/api/dist/cli/seed/seed-blog-categories-tags.js
```

**Note**: The compiled path is `dist/cli/seed/` NOT `dist/cli/scripts/seed/`. TypeScript's `tsc` strips the `scripts/` parent directory when all included files are under `scripts/`.

### Run Other Seeds

Other seed scripts follow the same pattern — find the compiled `.js` path:

```bash
# Example: List available compiled seed scripts
docker exec lucky-backend-prod ls /app/apps/api/dist/cli/seed/

# Run a specific seed
docker exec lucky-backend-prod node /app/apps/api/dist/cli/seed/<script-name>.js
```

### Alternative: Run Without Affecting Running Container

```bash
docker run --rm \
  --network lucky_app \
  --env-file /opt/lucky/deploy/.env.prod \
  --entrypoint "" \
  ghcr.io/mrbigporter/lucky-backend-prod:latest \
  node /app/apps/api/dist/cli/seed/seed-blog-categories-tags.js
```

---

## 5. Verifying Data

### Blog Categories and Tags

```bash
# Verify categories (expect: 6)
curl -s https://api.joyminis.com/api/v1/blog/categories | jq '.data | length'

# Verify tags (expect: 27)
curl -s https://api.joyminis.com/api/v1/blog/tags | jq '.data | length'

# Verify articles are intact (expect: > 0)
curl -s "https://api.joyminis.com/api/v1/blog/articles?pageSize=1" | jq '.data.meta.total'
```

### Health Check

```bash
# Basic health check
curl -s https://api.joyminis.com/api/v1/health

# Full response with status
curl -s https://api.joyminis.com/api/v1/health | jq .
```

---

## 6. Common Operations

### View Container Logs

```bash
# Follow API logs
docker logs -f lucky-backend-prod

# Last 100 lines
docker logs --tail=100 lucky-backend-prod

# Search for errors
docker logs lucky-backend-prod 2>&1 | grep -i error

# Nginx logs
docker logs --tail=50 lucky-nginx-prod
```

### Enter Container

```bash
docker exec -it lucky-backend-prod sh
```

### Check Running Containers

```bash
docker compose -f /opt/lucky/compose.prod.yml ps
```

### Restart Backend Only

```bash
docker compose -f /opt/lucky/compose.prod.yml restart backend
```

### Prisma Studio (View Data)

```bash
# Forward DB port locally (run on your machine, not server)
# Then connect Prisma Studio to localhost:5433
ssh -L 5433:localhost:5432 user@your-server
```

### Check Available Disk Space

```bash
df -h
docker system df
```

### Clean Up Old Docker Images

```bash
# Remove dangling images
docker image prune -f

# Remove all unused images (keeps recent ones)
docker image prune -a -f --filter "until=24h"
```

---

## 7. Troubleshooting

### Seed Script Not Found (MODULE_NOT_FOUND)

```
Error: Cannot find module '/app/apps/api/dist/cli/scripts/seed/seed-blog-categories-tags.js'
```

**Cause**: Wrong path. Compiled seeds are at `dist/cli/seed/` not `dist/cli/scripts/seed/`.

**Fix**:
```bash
# Correct path:
docker exec lucky-backend-prod node /app/apps/api/dist/cli/seed/seed-blog-categories-tags.js
```

### Seed Script Import Error (loadEnvForHost)

```
Error: Cannot find module '../utils/load-env-for-host'
```

**Cause**: `tsconfig.cli.json` doesn't include `scripts/utils/` in its `include` array.

**Fix**: Add `"scripts/utils/**/*.ts"` to `include` in [`tsconfig.cli.json`](../../../apps/api/tsconfig.cli.json), then commit + push to trigger a new Docker build.

### Health Check Failing After Deploy

**Steps**:
1. Check container logs: `docker logs --tail=50 lucky-backend-prod`
2. Check if DB is reachable: `docker exec lucky-backend-prod wget -qO- http://localhost:3000/api/v1/health`
3. The deploy workflow auto-rollbacks if health check fails after 90s

### Prisma Migration Fails

```bash
# Run migration manually inside a temporary container
docker run --rm \
  --network "$(docker inspect lucky-db-prod --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')" \
  --env-file /opt/lucky/deploy/.env.prod \
  --entrypoint "" \
  ghcr.io/mrbigporter/lucky-backend-prod:latest \
  ./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

---

## 8. Reference

### Key Files

| File | Purpose |
|------|---------|
| [`apps/api/SEED.md`](../../../apps/api/SEED.md) | Seed script quick reference (all seed scripts) |
| [`apps/api/scripts/seed/seed-blog-categories-tags.ts`](../../../apps/api/scripts/seed/seed-blog-categories-tags.ts) | Safe blog categories/tags seed |
| [`apps/api/scripts/seed/seed-blog.ts`](../../../apps/api/scripts/seed/seed-blog.ts) | ⚠️ Dangerous full blog reset seed |
| [`apps/api/tsconfig.cli.json`](../../../apps/api/tsconfig.cli.json) | CLI/seed compilation config |
| [`Dockerfile.prod`](../../../Dockerfile.prod) | Production Docker build (includes tsc for seeds) |
| [`.github/workflows/deploy-backend.yml`](../../../.github/workflows/deploy-backend.yml) | GitHub Actions backend deploy workflow |
| [`compose.prod.yml`](../../../compose.prod.yml) | Production Docker Compose config |

### Related Documentation

- [`docs/blog/architecture/BLOG_SYSTEM_BACKEND_ARCHITECTURE_CN.md`](../../../docs/blog/architecture/BLOG_SYSTEM_BACKEND_ARCHITECTURE_CN.md) — Backend architecture
- [`docs/blog/architecture/BLOG_CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md`](../../../docs/blog/architecture/BLOG_CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md) — Blog deployment architecture
- [`plans/deploy-seed-to-server-plan.md`](../../../plans/deploy-seed-to-server-plan.md) — Original seed deployment plan (historical)
