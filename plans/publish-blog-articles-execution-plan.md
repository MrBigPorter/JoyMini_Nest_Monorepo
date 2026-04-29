# Publish 46 Blog Articles — Execution Plan

## Root Cause of "fetch failed"

Backend container [`compose.yml:49-50`](compose.yml:49) uses `expose: ["3000"]` (internal only), NOT `ports: "3000:3000"`. So `http://localhost:3000` is unreachable from Mac host.

**Must use nginx proxy URL**: `https://dev-api.joyminis.com/api` (goes through local nginx on port 443, mapped to host via `compose.yml:260-261`)

## Dev Environment Test

```bash
ADMIN_USERNAME="admin" \
ADMIN_PASSWORD="admin888" \
API_URL="https://dev-api.joyminis.com/api" \
PUBLISH_STATUS="DRAFT" \
npx tsx scripts/batch-import-blog-articles.ts
```

## Production

```bash
make publish-blog-docs API_URL=https://api.joyminis.com/api PUBLISH_STATUS=PUBLISHED
```
