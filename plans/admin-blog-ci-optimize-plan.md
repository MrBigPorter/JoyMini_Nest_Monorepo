# Admin Blog CI & Build Optimization Plan

## Current State

### CI

- [`ci.yml`](.github/workflows/ci.yml) — main CI check workflow, runs on PR/main/test
  - ✅ Has lint, type-check, unit test steps
  - ❌ **Missing admin-blog build step** — cannot detect build failures before PR merge
  - ✅ Has frontend-blog build step
- [`deploy-admin-blog-cloudflare.yml`](.github/workflows/deploy-admin-blog-cloudflare.yml) — deploy workflow, has full quality + build + deploy

### open-next.config

- [`open-next.config.ts`](apps/admin-blog/open-next.config.ts) — currently `defineCloudflareConfig({})` (empty)
- [`admin-next/open-next.config.ts`](apps/admin-next/open-next.config.ts) — uses `incrementalCache: 'dummy'`, `tagCache: 'dummy'`, `queue: 'dummy'`
- [`frontend-blog/open-next.config.ts`](apps/frontend-blog/open-next.config.ts) — same as admin-next

The empty config in admin-blog means opennextjs-cloudflare will use default implementations that may require external infrastructure (KV/R2). Should match the admin-next pattern since both are admin panels with no ISR needs.

---

## Tasks

### Task 1: Add admin-blog build to main CI

**File:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)

Add a new step after the existing "Build — frontend-blog (required)" step:

```yaml
# 13) 构建 admin-blog（硬门禁）
- name: Build — admin-blog (required)
  run: yarn workspace @lucky/admin-blog build
  env:
    NODE_ENV: production
    NEXT_PUBLIC_API_BASE_URL: https://api.joyminis.com
    NEXT_PUBLIC_APP_ENV: production
```

Also add `apps/admin-blog/node_modules` to the node_modules cache paths (line 66-68):

```yaml
- name: Cache node_modules
  ...
  path: |
    node_modules
    apps/api/node_modules
    apps/admin-next/node_modules
    apps/admin-blog/node_modules      # ← add this
    apps/liveness-web/node_modules
    apps/frontend-blog/node_modules
    packages/*/node_modules
```

### Task 2: Update open-next.config.ts to match monorepo pattern

**File:** [`apps/admin-blog/open-next.config.ts`](apps/admin-blog/open-next.config.ts)

Current:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";

export default defineCloudflareConfig({});
```

Changed to (matching [`admin-next`](apps/admin-next/open-next.config.ts) pattern):

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Admin blog does NOT need ISR / incremental caching.
// Using "dummy" implementations keeps the Worker self-contained:
// no R2 bucket, no KV namespace required.
export default defineCloudflareConfig({
  incrementalCache: "dummy",
  tagCache: "dummy",
  queue: "dummy",
});
```

---

## Verification

1. Run `yarn workspace @lucky/admin-blog build` locally to verify the build succeeds
2. Run `yarn workspace @lucky/admin-blog check-types` to verify types
3. CI workflow syntax is validated by GitHub on push — no manual check needed for YAML
