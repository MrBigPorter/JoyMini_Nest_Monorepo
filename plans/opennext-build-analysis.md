# OpenNext Cloudflare Build Analysis

**Date**: 2026-05-01
**Commit**: 1ad7a04657b71e4c77136fc7ede96624032ae894
**App**: apps/frontend-blog (Next.js 15.2.4 + @opennextjs/cloudflare 1.17.1)

---

## Build Pipeline

```
┌─────────────────────────────────────────────────────┐
│ 1. OpenNext Init                                    │
│    Monorepo detected → apps/frontend-blog            │
│    Next.js 15.2.4 / opennextjs-cloudflare 1.17.1     │
├─────────────────────────────────────────────────────┤
│ 2. Next.js Build (optimized production build) ✅     │
│    PWA server+client compile ✓  Service Worker gen ✓ │
├─────────────────────────────────────────────────────┤
│ 3. Sentry Release Creation ⚠️ FAILED (non-fatal)     │
│    sentry-cli: Project not found                     │
├─────────────────────────────────────────────────────┤
│ 4. Manifest Copy Script ✅                            │
│    30 manifest files copied to ASSETS                 │
└─────────────────────────────────────────────────────┘
```

## Phase 1: Next.js Build ✅

| Component | Status | Detail |
|-----------|--------|--------|
| Production Build | ✅ | Optimized + compressed |
| PWA Server | ✅ | Compiled |
| PWA Client | ✅ | Static bundle compiled |
| Service Worker | ✅ | `/sw.js`, scope `/` |
| Offline Fallback | ✅ | `/offline.html` |

### Routes Generated (from manifests)

| Route | Type |
|-------|------|
| `/` | Home (SSG/ISR) |
| `/[locale]/` | Localized home |
| `/[locale]/articles/[slug]` | Article detail |
| `/[locale]/tags` / `/[locale]/tags/[slug]` | Tags |
| `/[locale]/categories` / `/[locale]/categories/[slug]` | Categories |
| `/[locale]/about` | About page |
| `/[locale]/bookmarks` | Bookmarks |
| `/[locale]/search` | Search |
| `/[locale]/login` | Login |
| `/[locale]/sitemap.xml` + `/sitemap.xml` | Sitemaps |
| `/robots.txt` | Robots |
| `/oauth/callback` | OAuth callback |
| `/_not-found` | Custom 404 |

---

## Issue 1: Sentry Error ⚠️ (Non-Fatal, Build-time)

### Error
```
sentry-cli releases new 1ad7a04657b71e4c77136fc7ede96624032ae894
error: Project not found. Ensure that you configured the correct project and organization.
```

### Root Cause: Missing `SENTRY_ORG` in CI

**CI workflow** ([`.github/workflows/deploy-blog-cloudflare.yml`](.github/workflows/deploy-blog-cloudflare.yml:196)):
```yaml
env:
  SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
  # ❌ SENTRY_ORG is NOT set here
```

**next.config.ts:427** reads it:
```ts
withSentryConfig(wrappedConfig, {
  org: process.env.SENTRY_ORG,    // ← undefined in CI!
  project: 'tarsier-labs',
  ...
})
```

Since `SENTRY_ORG` is `undefined`, Sentry CLI can't find which organization contains `tarsier-labs` project.

### Sentry Env Vars Used

| Env Var | Used Where | CI Status |
|---------|-----------|-----------|
| `SENTRY_ORG` | `next.config.ts:427` — Sentry plugin org | ❌ **Missing** |
| `SENTRY_AUTH_TOKEN` | `next.config.ts:431` — Source map upload auth | ✅ Present |
| `NEXT_PUBLIC_SENTRY_DSN` | `instrumentation.ts:23` — Runtime DSN | ❌ **Missing** from blog CI (admin CI has it) |
| `NEXT_PUBLIC_SENTRY_DEBUG` | `instrumentation.ts:34` | ✅ `false` |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `instrumentation-client.ts:33` | ❌ **Missing** (falls back to 0) |
| `NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE` | `instrumentation-client.ts:38` | ❌ **Missing** (falls back to 0) |

### Impact
| Area | Status | Detail |
|------|--------|--------|
| Source Map Upload | ❌ Failed | No release created, no source maps in Sentry |
| Runtime Error Tracking | ⚠️ Unknown | `NEXT_PUBLIC_SENTRY_DSN` not in CI env → may not initialize in deployment |
| Build | ✅ Continues | Error is non-fatal |
| Deployability | ✅ Can deploy | But with degraded monitoring |

**Fix**: Add `SENTRY_ORG` and `NEXT_PUBLIC_SENTRY_DSN` to CI workflow secrets.

---

## Issue 2: Missing i18n Translations 🐛 (Runtime)

### Error (from runtime debug logs)
```
Error: MISSING_MESSAGE: about.founderTitle (de)
Error: MISSING_MESSAGE: about.founderDescription (de)
```

### Root Cause

3 种语言缺少 `about.founderTitle` 和 `about.founderDescription`：

| Key | `en.json` | `zh.json` | `ja.json` | `ko.json` | `fr.json` | `de.json` |
|-----|:---------:|:---------:|:---------:|:---------:|:---------:|:---------:|
| `about.founderTitle` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `about.founderDescription` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `about.founderBio` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Fix**: Add the 2 missing keys to `ko.json`, `fr.json`, `de.json` (6 translations total).

---

## Phase 3: Manifest Copy ✅ (30 files)

### Source → Destination
```
.open-next/server-functions/default/apps/frontend-blog/.next/
  └── *manifest*.json           → .open-next/assets/_next/
  └── server/app/**/client-ref* → .open-next/assets/_next/server/app/
  └── server/*manifest*         → .open-next/assets/_next/server/
```

### File Categories
| Category | Count | Purpose |
|----------|-------|---------|
| Root manifest JSON | 6 | App build, route, build manifests |
| Client Reference JS | 14 | Per-route client component hydration |
| Other manifests | 10 | Fonts, middleware, server references |

## Build Output Structure

```
.open-next/
├── assets/                         ← Cloudflare ASSETS serves these
│   └── _next/static/               ← JS/CSS chunks (31536000s cache)
│   └── (manifest files)            ← copied by copy-manifests.sh
└── server-functions/
    └── default/
        └── apps/frontend-blog/
            ├── .next/              ← Full Next.js build output
            ├── worker.js           ← Cloudflare Worker entry
            └── (patched by patch-worker-queue.mjs)
```

## Summary

| Issue | Type | Severity | Fix Needed |
|-------|------|----------|------------|
| Sentry Release failed | Build warning | ⚠️ Low | Add `SENTRY_ORG` + `NEXT_PUBLIC_SENTRY_DSN` to CI secrets |
| Missing `founderTitle`/`founderDescription` in `ko.json`, `fr.json`, `de.json` | Runtime error | 🐛 Medium | Add 2 keys × 3 locales = 6 translations |

**Overall: Build is successful, deployable. Two non-blocking issues found.**
