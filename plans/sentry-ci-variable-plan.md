# Sentry CI Variable Integration Plan

## Background

The Sentry release step fails in CI because `SENTRY_ORG` is not set in the workflow `env:` block. Runtime Sentry initialization also relies on `NEXT_PUBLIC_SENTRY_DSN`, which is also absent.

You created two GitHub Actions **Variables**:

| Variable Name | Value Example (per earlier message) |
|---|---|
| `NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN` | `blog_frontend_joyminis` |
| `NEXT_PUBLIC_OYMINIS_ORG` | `joymini` |

## What the Code Expects

| Code Location | Env Var Used | Purpose |
|---|---|---|
| [`next.config.ts:427`](apps/frontend-blog/next.config.ts#427) | `process.env.SENTRY_ORG` | Sentry CLI org slug for release creation |
| [`instrumentation.ts:23`](apps/frontend-blog/src/instrumentation.ts#23) | `process.env.NEXT_PUBLIC_SENTRY_DSN` | Runtime DSN URL for Sentry SDK init |

## Issues to Address

### 1. Variable Name Mismatch

Your GitHub Variables are named differently from what the code expects:

| Your GitHub Variable | Code Expects | Mapping Needed |
|---|---|---|
| `NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN` | `NEXT_PUBLIC_SENTRY_DSN` | `NEXT_PUBLIC_SENTRY_DSN: ${{ vars.NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN }}` |
| `NEXT_PUBLIC_OYMINIS_ORG` | `SENTRY_ORG` | `SENTRY_ORG: ${{ vars.NEXT_PUBLIC_OYMINIS_ORG }}` |

**Note on typos**: `FRONENT` (missing `T`, should be `FRONTEND`) and `OYMINIS` (missing `J`, should be `JOYMINIS`). If you want to rename, you'd need to delete and recreate them in GitHub. Otherwise, the mapping above handles it.

### 2. DSN Value Format Concern

Earlier you showed `blog_frontend_joyminis` as the DSN value, but this looks like a **project slug**, not a DSN URL. A valid Sentry DSN URL looks like:
```
https://xxx@o999999.ingest.sentry.io/9999999
```

If the value you stored in the GitHub Variable `NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN` is not a valid DSN URL, the runtime Sentry SDK in [`instrumentation.ts:26`](apps/frontend-blog/src/instrumentation.ts#26) will skip initialization (it has a guard: `if (!dsn) return`), so it won't crash — but Sentry won't capture runtime errors either.

The build-time Sentry plugin in [`next.config.ts:425-434`](apps/frontend-blog/next.config.ts#425) only uses `SENTRY_ORG` for release creation — it doesn't use the DSN at build time.

### 3. Build-time Guard (Optional but Recommended)

Currently [`next.config.ts:425`](apps/frontend-blog/next.config.ts#425) always runs `withSentryConfig` when `NODE_ENV === 'production'`. If `SENTRY_ORG` is undefined or invalid, Sentry CLI fails during build. With the mapping above, this should be resolved — but adding a guard would make the build resilient:

```ts
export default (process.env.NODE_ENV === 'production' && process.env.SENTRY_ORG)
  ? withSentryConfig(wrappedConfig, { ... })
  : wrappedConfig;
```

## Changes Required

### File 1: `.github/workflows/deploy-blog-cloudflare.yml`

Add two lines to the `env:` block at line 186:

```yaml
# Add after line 195 (before SENTRY_AUTH_TOKEN):
NEXT_PUBLIC_SENTRY_DSN: ${{ vars.NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN }}
SENTRY_ORG: ${{ vars.NEXT_PUBLIC_OYMINIS_ORG }}
```

### File 2: `apps/frontend-blog/next.config.ts` (Optional)

Add a guard condition to skip Sentry plugin when `SENTRY_ORG` is missing, making the build resilient.

## Decision Needed

1. **Are these GitHub "Variables" (`vars.*`) or "Secrets" (`secrets.*`)?** The plan uses `vars.*` based on your wording "变量" (variables).
2. **Is the DSN value stored in `NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN` a valid Sentry DSN URL** (starts with `https://...ingest.sentry.io/...`), or is it just a project slug name?
3. **Should I add the guard condition** in `next.config.ts` to skip Sentry plugin if env vars are missing?
