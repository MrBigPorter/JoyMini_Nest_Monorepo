# Lucky Blog — Multi-Platform Blog Platform

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](apps/frontend-blog/package.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](apps/frontend-blog/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)
[![Capacitor](https://img.shields.io/badge/Capacitor-6-119EFF?logo=capacitor)](apps/frontend-blog/package.json)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20KV-F38020?logo=cloudflare)](apps/frontend-blog/wrangler.jsonc)
[![PWA](https://img.shields.io/badge/PWA-Enabled-5A0FC8?logo=pwa)](apps/frontend-blog/public/sw.js)

> A high-performance, multi-platform blog application built with Next.js 15, supporting Web, iOS, and Android via Capacitor 6. Part of the [Lucky Nest Monorepo](../README.md).

---

## ✨ Overview

Lucky Blog is a modern blog platform that delivers content across **Web**, **iOS**, and **Android** from a single codebase. It uses a **Unified Platform Adapter Architecture** to detect the runtime environment and adapt behavior accordingly — providing native app experiences via Capacitor while maintaining full PWA capabilities on the web.

The blog is deployed on **Cloudflare Pages** with **Workers** for edge rendering, **KV** for ISR caching, and achieves sub-200ms TTFB globally.

---

## 🛠️ Tech Stack

| Category           | Technologies                                           |
| ------------------ | ------------------------------------------------------ |
| **Framework**      | Next.js 15 (App Router), React 19, TypeScript 5.5      |
| **Mobile**         | Capacitor 6 (iOS + Android), Xcode 15+, Android Studio |
| **Styling**        | Tailwind CSS, Framer Motion                            |
| **State**          | Zustand, TanStack Query                                |
| **i18n**           | next-intl (6 languages)                                |
| **Auth**           | OAuth 2.0 (Google, Facebook, Apple), JWT cookies       |
| **Infrastructure** | Cloudflare Pages, Workers, KV, ISR                     |
| **PWA**            | Service Worker, offline fallback, manifest             |
| **Testing**        | Vitest, Playwright, Lighthouse CI                      |
| **Monitoring**     | Sentry, Cloudflare Analytics                           |

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

**Solution:** A custom Service Worker (generated with Workbox) that implements a **stale-while-revalidate** strategy for blog content and a **cache-first** strategy for static assets. Critical resources (recent articles, styles, fonts) are pre-cached during installation. A custom `useOffline` hook detects connectivity changes and adjusts the UI accordingly.

[View Service Worker](apps/frontend-blog/public/sw.js) | [View offline hook](apps/frontend-blog/src/hooks/useOffline.ts)

---

### 5. Platform-Aware React Query with Automatic Degradation

**Problem:** React Query configurations that work well on the web (aggressive caching, background refetching) cause issues on mobile apps (battery drain, stale data). The same query needs different `staleTime`, `gcTime`, and `retry` settings depending on the platform.

**Solution:** A platform-aware QueryClient factory that adjusts defaults based on `usePlatform()` detection. On Capacitor (native), caching is more aggressive and network retries are reduced. On Web, background refetching is enabled for freshness. Server Actions are used when available, with automatic fallback to REST API calls.

[View platform detection](apps/frontend-blog/src/lib/utils/platform.ts) | [View API client](apps/frontend-blog/src/lib/api/http.ts)

---

## 📁 Project Structure

```
apps/frontend-blog/
├── src/
│   ├── app/                    # Next.js 15 App Router
│   │   ├── [locale]/          # i18n route segments
│   │   │   ├── page.tsx       # Homepage
│   │   │   ├── articles/      # Article listing & detail
│   │   │   ├── categories/    # Category pages
│   │   │   ├── search/        # Search with full-text
│   │   │   └── ...            # More routes
│   │   ├── api/               # API routes (auth, bookmarks, etc.)
│   │   └── oauth/             # OAuth callback handlers
│   ├── lib/
│   │   ├── api/               # HTTP client, query keys, API functions
│   │   ├── hooks/             # Custom hooks (auth, bookmarks, comments, etc.)
│   │   ├── stores/            # Zustand stores (auth, cookie-storage)
│   │   ├── utils/             # Utilities (oauth, platform, date, locale)
│   │   ├── components/        # Shared components (BookmarkButton, Toast, etc.)
│   │   └── i18n/              # i18n configuration
│   ├── hooks/                 # App-level hooks (PWA, offline, available locales)
│   └── components/            # UI components
├── public/
│   ├── sw.js                  # Service Worker (Workbox)
│   ├── manifest.json          # PWA manifest
│   └── icons/                 # App icons (all sizes)
├── android/                   # Capacitor Android project
├── capacitor.config.ts        # Capacitor configuration
├── wrangler.toml              # Cloudflare Workers config
└── middleware.ts              # Next.js middleware (i18n, auth)
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

| Feature            | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| **Multi-Platform** | Web (Next.js SSR), iOS (Capacitor), Android (Capacitor)      |
| **i18n**           | 6 languages with route-param locale detection                |
| **PWA**            | Offline support, installable, push notifications             |
| **OAuth Login**    | Google, Facebook, Apple authentication                       |
| **Bookmarks**      | Save articles, batch bookmark status queries                 |
| **Comments**       | Nested comments with real-time updates                       |
| **Search**         | Full-text search with highlighting                           |
| **ISR Caching**    | Edge-level incremental static regeneration via Cloudflare KV |
| **Performance**    | LCP < 2.5s, TTFB < 200ms, Lighthouse 90+                     |
| **SEO**            | Structured data, Open Graph, sitemap                         |

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

### Caching Architecture

```
1. KV ISR Cache (Worker)   → Rendered pages, KV-backed ISR
2. CDN Edge Cache           → Static assets + HTML, CF edge nodes
3. Browser Cache            → JS/CSS 1y, Images 7d, HTML 1h
```

See [BLOG_CACHING_ARCHITECTURE.md](../docs/blog/caching/BLOG_CACHING_ARCHITECTURE.md) for detailed architecture diagrams, cache key design, and verification procedures.

### Performance Targets

| Metric          | Target  |
| --------------- | ------- |
| LCP             | < 2.5s  |
| FCP             | < 1.0s  |
| CLS             | < 0.1   |
| TTFB            | < 200ms |
| Page Transition | < 300ms |

---

## 🔗 Related

- [Monorepo Root](../README.md) — Project overview and architecture
- [@lucky/api](../api/README.md) — NestJS backend API
- [@lucky/shared](../packages/shared/README.MD) — Shared types and utilities
- [@repo/ui](../packages/ui/README.md) — Shared UI component library

---

## 📄 License

Part of the Lucky Nest Monorepo. See the [root license](../README.md) for details.
