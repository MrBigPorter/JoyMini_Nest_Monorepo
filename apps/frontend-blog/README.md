# Lucky Blog — Multi-Platform Blog Platform

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](apps/frontend-blog/package.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](apps/frontend-blog/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)
[![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF?logo=capacitor)](apps/frontend-blog/package.json)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20KV-F38020?logo=cloudflare)](apps/frontend-blog/wrangler.jsonc)
[![PWA](https://img.shields.io/badge/PWA-Enabled-5A0FC8?logo=pwa)](apps/frontend-blog/src/app/layout.tsx)
[![IndexedDB](https://img.shields.io/badge/IndexedDB-Dexie.js-2C2255?logo=indexeddb)](apps/frontend-blog/src/lib/db/db.ts)

> A high-performance, multi-platform blog application built with Next.js 15, supporting Web, iOS, and Android via Capacitor 6. Part of the [Lucky Nest Monorepo](../README.md).

---

## ✨ Overview

Lucky Blog is a modern blog platform that delivers content across **Web**, **iOS**, and **Android** from a single codebase. It uses a **Unified Platform Adapter Architecture** to detect the runtime environment and adapt behavior accordingly — providing native app experiences via Capacitor while maintaining full PWA capabilities on the web.

The blog features a **Local-First offline architecture** powered by Dexie.js (IndexedDB), ensuring content is instantly available even without a network connection. Combined with Service Worker caching and Cloudflare edge ISR, the blog achieves sub-200ms TTFB globally and seamless offline reading.

---

## 🛠️ Tech Stack

| Category                | Technologies                                                       |
| ----------------------- | ------------------------------------------------------------------ |
| **Framework**           | Next.js 15 (App Router), React 19, TypeScript 5.5                  |
| **Mobile**              | Capacitor 6 (iOS + Android), Xcode 15+, Android Studio             |
| **Styling**             | Tailwind CSS, Framer Motion                                        |
| **State**               | Zustand, TanStack Query                                            |
| **Offline Storage**     | Dexie.js (IndexedDB), Service Worker / Workbox Cache Storage       |
| **i18n**                | next-intl (6 languages)                                            |
| **Auth**                | OAuth 2.0 (Google, Facebook, Apple), JWT cookies                   |
| **Infrastructure**      | Cloudflare Pages, Workers, KV, ISR                                 |
| **PWA**                 | next-pwa (Workbox v6), Service Worker, offline fallback, manifest  |
| **Testing**             | Vitest, Playwright, Lighthouse CI                                  |
| **Monitoring**          | Sentry, Cloudflare Analytics                                       |

---

## 🧠 Technical Challenges & Solutions

### 1. Unified Platform Adapter Architecture

**Problem:** Maintaining separate codebases for Web, iOS, and Android is expensive and leads to inconsistent user experiences. The app needs to detect the runtime environment and adapt rendering, caching, and API behavior accordingly — all from a single codebase.

**Solution:** A layered architecture with a **Platform-Aware Layer** that sits between the application and platform adapters. React Query configurations, caching strategies, and network handling are adjusted automatically based on the detected platform (Web browser, mobile browser, or Capacitor native app).

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                       │
│  Pages │ Components │ Router (Next.js App Router)         │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              Platform-Aware Layer                          │
│  Platform Hooks │ Platform Query │ Platform Mutation      │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│              Platform Adapters                             │
│  Web (Next.js) │ H5 (Mobile Web) │ App (Capacitor)       │
└─────────────────────────────────────────────────────────┘
```

[View platform hooks](apps/frontend-blog/src/lib/hooks) | [View platform utils](apps/frontend-blog/src/lib/utils/platform.ts)

---

### 2. Multi-Layer Caching Architecture for Edge Performance

**Problem:** Server-side rendering from a single region causes high latency for global users. Full static generation doesn't work for dynamic blog content that updates frequently, and without a proper caching strategy, every request hits the origin.

**Solution:** A three-layer caching architecture deployed on **Cloudflare Workers**:

1. **KV ISR Cache** — OpenNext's built-in `kvIncrementalCache` stores rendered pages in Cloudflare KV. On revalidation-triggering events (content publish/update), the cache is purged and pages are re-rendered at the edge.
2. **CDN Edge Cache** — Cloudflare's global CDN (330+ locations) caches responses with `Cache-Control` headers. HTML pages: `max-age=3600, stale-while-revalidate=86400`, static assets: `max-age=31536000, immutable`.
3. **Browser Cache** — Short TTL for HTML (1h), long TTL for JS/CSS (1y), images and fonts cached for 7d.

Configured via [`open-next.config.ts`](apps/frontend-blog/open-next.config.ts) using OpenNext's official KV incremental cache override:

```typescript
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import kvTagCache from "@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache";

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: kvTagCache,
});
```

[View open-next.config.ts](apps/frontend-blog/open-next.config.ts) | [View caching architecture docs](../docs/blog/caching/BLOG_CACHING_ARCHITECTURE.md) | [View verification script](../deploy/verify-blog-cache.sh)

---

### 3. Capacitor Deep-Link OAuth Flow

**Problem:** OAuth login on mobile apps requires redirecting to a browser, then returning to the app. The redirect URI must use a custom scheme (`com.tarsier.labs://`), and the OAuth state must survive the app-switching lifecycle without security vulnerabilities.

**Solution:** A custom OAuth flow where:

1. The mobile app opens the system browser with OAuth URL (including state + PKCE challenge)
2. The server authenticates and redirects to the custom scheme URL
3. Capacitor's `App.addListener('appUrlOpen')` captures the redirect
4. The state parameter is validated, and the auth code is exchanged for tokens

[View OAuth utilities](apps/frontend-blog/src/lib/utils/oauth.ts) | [View Capacitor config](apps/frontend-blog/capacitor.config.ts)

---

### 4. PWA with Service Worker Offline Fallback

**Problem:** Users in areas with unreliable connectivity should still be able to read cached articles. The PWA must work offline while staying up-to-date when connectivity is available.

**Solution:** A Service Worker (generated by [next-pwa](apps/frontend-blog/next.config.ts) with Workbox) implementing a multi-strategy caching system:

| Cache | Strategy | Usage |
|-------|----------|-------|
| **Static JS/CSS** | StaleWhileRevalidate (32 entries) | Framework & app bundles |
| **Static Images** | StaleWhileRevalidate (200 entries) | Icons, logos, static images |
| **API Responses** | StaleWhileRevalidate (50 entries, 7d) | Blog API data |
| **Pages Cache** | NetworkFirst (50 entries, 7d) | Root page `/` |
| **Navigation Pages** | NetworkFirst (50 entries, 7d, 5s timeout) | Locale routes `/(zh\|en\|ko\|ja)/` |

A custom [`useOffline`](apps/frontend-blog/src/hooks/useOffline.ts) hook detects connectivity changes (online/offline events + periodic pings) and adjusts the UI accordingly. An [`OfflineIndicator`](apps/frontend-blog/src/components/pwa/OfflineIndicator.tsx) component provides bottom-sheet notifications with retry capability.

In development, the SW can be enabled by setting `NEXT_PWA_ENABLE=true` environment variable.

[View next-pwa config](apps/frontend-blog/next.config.ts) | [View offline hook](apps/frontend-blog/src/hooks/useOffline.ts)

---

### 5. Platform-Aware React Query with Automatic Degradation

**Problem:** React Query configurations that work well on the web (aggressive caching, background refetching) cause issues on mobile apps (battery drain, stale data). The same query needs different `staleTime`, `gcTime`, and `retry` settings depending on the platform.

**Solution:** A platform-aware QueryClient factory that adjusts defaults based on `usePlatform()` detection. On Capacitor (native), caching is more aggressive and network retries are reduced. On Web, background refetching is enabled for freshness. Server Actions are used when available, with automatic fallback to REST API calls.

[View platform detection](apps/frontend-blog/src/lib/utils/platform.ts) | [View API client](apps/frontend-blog/src/lib/api/http.ts)

---

### 6. Local-First Offline Architecture with IndexedDB

**Problem:** Service Worker cache alone is insufficient for a rich offline experience — it can cache API responses but cannot provide the structured querying needed for category filtering, tag browsing, or article search. Users on slow or intermittent connections need content to render immediately without waiting for network responses.

**Solution:** A **four-tier local-first caching system** using Dexie.js (IndexedDB) as the persistent client-side database:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Local-First Data Layer                           │
│                                                                      │
│  queryFn  →  1. Read IndexedDB (Dexie) → Instant render              │
│              2. Background network fetch                              │
│              3. Success → Update IndexedDB + refresh UI               │
│              4. Failure → Keep IndexedDB data (offline)               │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Smart Prefetch Layer                             │
│                                                                      │
│  ┌──────────────────┐  ┌─────────────────────────┐                   │
│  │ Intersection     │  │ Network-Aware Quality    │                   │
│  │ Observer 200px   │  │ (effectiveType, saveData) │                   │
│  │ prefetch images  │  │ adaptive quality/blur     │                   │
│  └────────┬─────────┘  └──────────┬──────────────┘                   │
│           │                        │                                  │
│           ▼                        ▼                                  │
│  ┌──────────────────────────────────────────────┐                    │
│  │  postMessage → Service Worker                 │                    │
│  │  { type: 'PREFETCH_IMAGES', urls: [...] }    │                    │
│  └──────────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Service Worker Cache Storage                      │
│  ├─ static-image-assets     │ StaleWhileRevalidate │ 200 entries     │
│  ├─ static-js-css-assets    │ StaleWhileRevalidate │ 32 entries      │
│  ├─ api-cache               │ StaleWhileRevalidate │ 50 / 7d         │
│  ├─ pages-cache             │ NetworkFirst         │ 50 / 7d         │
│  └─ navigation-pages        │ NetworkFirst         │ 50 / 7d         │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge (KV + CDN)                         │
│  KV Incremental Cache | CDN Edge Cache | Browser Cache               │
└─────────────────────────────────────────────────────────────────────┘
```

#### IndexedDB Schema

Defined in [`db.ts`](apps/frontend-blog/src/lib/db/db.ts) using Dexie.js:

| Table             | Key       | Purpose                          | Synced By                       |
| ----------------- | --------- | -------------------------------- | ------------------------------- |
| `articles`        | `id`      | Article metadata + slugs         | `useFrontendArticles`           |
| `articleContents` | `slug`    | Full article body (HTML/MDX)     | `useFrontendArticleBySlug`      |
| `categories`      | `id`      | Category list with translations  | `useFrontendCategories`         |
| `tags`            | `id`      | Tag list with translations       | `useFrontendTags`               |
| `metadata`        | `key`     | Sync timestamps, version info    | Internal                        |

#### Local-First Hooks

All data-fetching hooks use `networkMode: 'offlineFirst'` to prioritize local data:

| Hook | Table | File |
|------|-------|------|
| `useFrontendArticles` | `articles` | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) |
| `useFrontendArticleBySlug` | `articleContents` | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) |
| `useFrontendCategories` | `categories` | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) |
| `useFrontendTags` | `tags` | [`useFrontendArticles.ts`](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts) |

#### Sync Functions

Defined in [`sync.ts`](apps/frontend-blog/src/lib/db/sync.ts):
- `syncArticles` / `getCachedArticles` — Batch article sync with stale pruning
- `syncArticleContent` / `getCachedArticleContent` — Single article body cache
- `syncCategories` / `getCachedCategories` — Category list cache
- `syncTags` / `getCachedTags` — Tag list cache
- `clearAllCachedData` — Full cache reset (version migration support)

#### Homepage Optimizations

Beyond the local-first data layer, several performance optimizations are applied specifically to the homepage:

| Optimization | Implementation | Benefit |
|---|---|---|
| **View Transitions API** | Crossfade on category switch, `prefers-reduced-motion` fallback | Smooth visual transitions |
| **Hover Pre-fetch** | `onMouseEnter` triggers `queryClient.prefetchQuery` | Instant category switch |
| **SSR Initial Categories** | Server-rendered category list passed as `initialData` | Eliminates skeleton flash |
| **Network-Aware Quality** | `useNetworkQuality` hook adapts image quality based on `effectiveType` | Fast load on 2G/3G |
| **IntersectionObserver Pre-fetch** | Images prefetched 200px before entering viewport | Eliminates image loading delay |
| **Bottom Auto-Prefetch** | Automatically prefetches next page when scrolling near bottom | No Load More waiting |
| **Priority Images** | First 2 cards `priority={true}` | LCP improvement |
| **AVIF/WebP Conversion** | Next.js `formats` config + quality=65 for non-LCP | Smaller images |

[View IndexedDB schema](apps/frontend-blog/src/lib/db/db.ts) | [View sync logic](apps/frontend-blog/src/lib/db/sync.ts) | [View hooks](apps/frontend-blog/src/lib/hooks/useFrontendArticles.ts)

---

## 📁 Project Structure

```
apps/frontend-blog/
├── src/
│   ├── app/                    # Next.js 15 App Router
│   │   ├── [locale]/          # i18n route segments
│   │   │   ├── page.tsx       # Homepage (SSR + ISR 60s)
│   │   │   ├── page.client.tsx# Homepage client logic (View Transitions, pre-fetch)
│   │   │   ├── articles/      # Article listing & detail
│   │   │   ├── categories/    # Category pages
│   │   │   ├── search/        # Search with full-text
│   │   │   └── ...            # More routes
│   │   ├── api/               # API routes (auth, bookmarks, etc.)
│   │   └── oauth/             # OAuth callback handlers
│   ├── lib/
│   │   ├── api/               # HTTP client, query keys, API functions
│   │   ├── hooks/             # Custom hooks (auth, bookmarks, articles, etc.)
│   │   ├── db/                # IndexedDB schema + sync (Dexie.js)
│   │   │   ├── db.ts          # Tables: articles, categories, tags, articleContents
│   │   │   └── sync.ts        # Sync functions: sync + getCached + prune
│   │   ├── stores/            # Zustand stores (auth, cookie-storage)
│   │   ├── utils/             # Utilities (oauth, platform, date, locale)
│   │   ├── components/        # Shared components (BookmarkButton, Toast, etc.)
│   │   ├── i18n/              # i18n configuration
│   │   └── pwa/               # PWA manifest loader, locale-aware manifest
│   ├── hooks/                 # App-level hooks (PWA, offline, available locales)
│   ├── components/            # UI components
│   │   ├── blog/              # Blog-specific (ArticleCard, CategoryFilter, LoadMore, etc.)
│   │   └── pwa/               # PWA UI (OfflineIndicator, UpdateAvailable)
│   └── instrumentation.ts    # Sentry + OpenTelemetry
├── public/
│   ├── sw.js                  # Service Worker (auto-generated by build)
│   ├── manifest.json          # PWA manifest
│   ├── manifest-{locale}.json # Locale-specific manifests (zh, en, ja, ko)
│   ├── offline.html           # Offline fallback page
│   └── icons/                 # App icons (all sizes)
├── android/                   # Capacitor Android project
├── ios/                       # Capacitor iOS project
├── capacitor.config.ts        # Capacitor configuration
├── next.config.ts             # Next.js + next-pwa + image optimization
├── open-next.config.ts        # Cloudflare OpenNext config
├── middleware.ts              # Next.js middleware (i18n, auth)
└── worker.ts                  # Cloudflare Worker (ISR + caching + analytics)
```

---

## 🚀 Quick Start

```bash
# From monorepo root

# Install dependencies
yarn install

# Build shared dependencies
yarn workspace @lucky/shared build

# Start dev server (port 4002)
yarn workspace @lucky/frontend-blog dev

# Or with Turbopack
yarn workspace @lucky/frontend-blog dev:turbo
```

### Enable PWA in Development

By default, the Service Worker is disabled in dev mode. To test offline/PWA features locally:

```bash
NEXT_PWA_ENABLE=true yarn workspace @lucky/frontend-blog dev
```

### Mobile Development (iOS)

```bash
# Full setup (first time)
yarn workspace @lucky/frontend-blog dev:full

# Daily development with hot reload
yarn workspace @lucky/frontend-blog dev:ios

# Build only
yarn workspace @lucky/frontend-blog build:ios
```

### Cloudflare Deployment

```bash
# Build for Cloudflare
yarn workspace @lucky/frontend-blog build:cloudflare

# Deploy to preview
yarn workspace @lucky/frontend-blog deploy:cloudflare:preview

# Deploy to production
yarn workspace @lucky/frontend-blog deploy:cloudflare:production
```

---

## 📦 Key Features

| Feature                | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| **Multi-Platform**     | Web (Next.js SSR), iOS (Capacitor), Android (Capacitor)               |
| **i18n**               | 6 languages with route-param locale detection                         |
| **Local-First Offline**| IndexedDB-backed content cache, offline articles/categories/tags     |
| **PWA**                | Installable, Service Worker (NetworkFirst + StaleWhileRevalidate)     |
| **View Transitions**   | Crossfade animations on category switch (Chrome 111+)                 |
| **Adaptive Quality**   | Network-aware image quality (useNetworkQuality hook)                 |
| **Hover Pre-fetch**    | Category data prefetched on mouse hover for instant switch            |
| **OAuth Login**        | Google, Facebook, Apple authentication                                |
| **Bookmarks**          | Save articles, batch bookmark status queries                          |
| **Comments**           | Nested comments with real-time updates                                |
| **Search**             | Full-text search with highlighting                                    |
| **ISR Caching**        | Edge-level incremental static regeneration via Cloudflare KV          |
| **Performance**        | LCP < 1.2s, TTFB < 200ms, Lighthouse 90+                              |
| **SEO**                | Structured data, Open Graph, sitemap                                  |

---

## 🧪 Testing

```bash
# Unit tests
yarn workspace @lucky/frontend-blog test

# E2E tests (Playwright)
yarn workspace @lucky/frontend-blog test:e2e

# Performance audit
yarn workspace @lucky/frontend-blog performance-audit
```

---

## 🌐 Architecture

### Caching Architecture (Full Stack)

```
1. IndexedDB Client Cache   → Articles, categories, tags (Dexie.js, Local-First)
2. Service Worker Cache      → Navigation pages + API + static assets (Workbox)
3. CDN Edge Cache            → Static assets + HTML (Cloudflare, 330+ nodes)
4. KV ISR Cache (Worker)     → Rendered pages (OpenNext + Cloudflare KV)
5. Browser Cache             → JS/CSS 1y, Images 7d, HTML 1h (Cache-Control)
```

See [BLOG_CACHING_ARCHITECTURE.md](../docs/blog/caching/BLOG_CACHING_ARCHITECTURE.md) for detailed architecture diagrams, cache key design, and verification procedures.

---

### Offline Capabilities

| Scenario | Before Optimization | After Optimization |
|----------|--------------------|--------------------|
| No network, first visit | ❌ Chrome dinosaur | ✅ SSR + ISR cached page |
| No network, revisit | ❌ White screen | ✅ Article list + categories + tags |
| Slow 3G | ~3-5s blank blocks | ✅ IndexedDB instant render → background update |
| Category switch | ~200ms API wait | ✅ ~50ms (IndexedDB local read) |
| Article details offline | ❌ Not available | ✅ Cached body content readable |

### Performance Targets

| Metric          | Current Target |
| --------------- | -------------- |
| LCP             | < 1.2s        |
| FCP             | < 0.8s        |
| CLS             | < 0.05        |
| TTFB            | < 200ms       |
| Page Transition | < 100ms       |
| Offline FCP     | < 500ms       |

---

## 🔗 Related

- [Monorepo Root](../README.md) — Project overview and architecture
- [@lucky/api](../api/README.md) — NestJS backend API
- [@lucky/shared](../packages/shared/README.MD) — Shared types and utilities
- [@repo/ui](../packages/ui/README.md) — Shared UI component library

---

## 📄 License

Part of the Lucky Nest Monorepo. See the [root license](../README.md) for details.
