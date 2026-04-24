# @lucky/admin-next — Enterprise Admin Dashboard

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](apps/admin-next/package.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](apps/admin-next/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)](apps/admin-next/tsconfig.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss)](apps/admin-next/tailwind.config.mts)
[![Vitest](https://img.shields.io/badge/Vitest-4-green?logo=vitest)](apps/admin-next/vitest.config.ts)
[![Sentry](https://img.shields.io/badge/Sentry-10-362D59?logo=sentry)](apps/admin-next/package.json)

> A full-featured enterprise admin dashboard built with Next.js 15 App Router, React 19, and TypeScript. Part of the [Lucky Nest Monorepo](../README.md).

---

## ✨ Overview

`@lucky/admin-next` is the administrative control panel for the Lucky Nest platform. It provides a comprehensive set of management tools for operators to handle users, orders, finance, content, KYC verification, real-time customer service, and more.

The dashboard is built with **Next.js 15 App Router** for optimal SSR/SSG performance, **Zustand** for client-state persistence, **TanStack Query** for server-state caching, and **Socket.IO** for real-time communications. It supports **6 languages** via `next-intl` with zero-flicker theme hydration.

---

## 🛠️ Tech Stack

| Category       | Technologies                                               |
| -------------- | ---------------------------------------------------------- |
| **Framework**  | Next.js 15 (App Router), React 19, TypeScript 5.5          |
| **Styling**    | Tailwind CSS 4, Framer Motion, Lucide Icons                |
| **State**      | Zustand 4 (persisted), TanStack Query 5, TanStack Table 8  |
| **Forms**      | React Hook Form 7, Zod 3, @hookform/resolvers              |
| **HTTP**       | Axios (custom HttpClient with retry, dedup, token refresh) |
| **i18n**       | next-intl 4 (6 languages: EN, ZH, JA, KO, FR, DE)          |
| **Real-time**  | Socket.IO Client                                           |
| **AI**         | Google Generative AI (Gemini)                              |
| **Testing**    | Vitest 4, Playwright, Lighthouse CI                        |
| **Monitoring** | Sentry 10, @sentry/nextjs                                  |
| **Deployment** | Docker, Cloudflare Pages (OpenNext)                        |

---

## 🧠 Technical Challenges & Solutions

### 1. Zero-Flicker Theme Hydration

**Problem:** When using Zustand with localStorage persistence for theme state, Next.js SSR renders without theme context. On hydration, the theme class is applied asynchronously, causing a visible white/black flash (FOUC) on every page load.

**Solution:** An inline `<script>` executes **before React hydration** — it reads `localStorage` synchronously and applies the theme class to `<html>` immediately. The script key (`app-store`) stays in sync with Zustand's persist config.

```typescript
// apps/admin-next/src/app/layout.tsx:83-87
<script
  dangerouslySetInnerHTML={{
    __html: `(function(){try{var s=JSON.parse(localStorage.getItem('app-store')||'{}');
    var t=(s.state&&s.state.theme)||'dark';
    document.documentElement.classList.add(t);}catch(e){
    document.documentElement.classList.add('dark');}})();`,
  }}
/>
```

[View source](apps/admin-next/src/app/layout.tsx:78)

---

### 2. Enterprise-Grade HTTP Client with Race Condition Prevention

**Problem:** In a dashboard with rapid data fetching, multiple concurrent API calls can cause: (a) duplicate identical requests, (b) race conditions during token refresh (multiple 401s trigger multiple refresh calls), (c) no retry mechanism for transient failures.

**Solution:** A custom [`HttpClient`](apps/admin-next/src/api/http.ts:17) class with three key mechanisms:

- **Request deduplication** via `AbortController`: identical in-flight GET requests are deduped by a generated key — the second caller awaits the same promise.
- **Single-fly token refresh**: concurrent 401 responses share a single `refreshPromise` — only one refresh call is made, all wait for the same result.
- **Exponential backoff retry**: 3 retries with `min(1000 * 2^attempt, 30000)` ms delay, only for network errors and 5xx responses.

```typescript
// apps/admin-next/src/api/http.ts:19-25
private requestQueue = new Set<string>();
private pendingControllers = new Map<string, AbortController>();
private inflightGetRequests = new Map<string, Promise<unknown>>();
private _unauthorizedHandling = false;
private refreshPromise: Promise<string | null> | null = null;
```

[View source](apps/admin-next/src/api/http.ts:17)

---

### 3. SSR-Safe State Management with Zustand

**Problem:** Zustand's `persist` middleware with `localStorage` storage crashes Next.js SSR because `localStorage` is undefined on the server. The app also needs to avoid hydration mismatches between server-rendered and client-rendered HTML.

**Solution:** A custom storage adapter that returns a no-op implementation during SSR, and the real `localStorage` on the client. Combined with `suppressHydrationWarning` on the `<html>` tag and the inline script above for theme.

```typescript
// apps/admin-next/src/store/useAppStore.ts:43-53
storage: createJSONStorage(() => {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return localStorage;
}),
```

[View source](apps/admin-next/src/store/useAppStore.ts:41)

---

### 4. Multi-Language i18n with Route-Param Locale

**Problem:** The dashboard must support 6 languages (EN, ZH, JA, KO, FR, DE) with locale determined by the URL route parameter `/[locale]/...`. The locale must be available in both Server Components (for SSR) and Client Components (for interactivity), and TanStack Query keys must include the locale to prevent cross-language cache collisions.

**Solution:** Using `next-intl` with route-based locale detection. Query keys are constructed to include the current locale, ensuring cached data is language-specific. A custom `useTranslation` hook bridges server and client i18n.

[View i18n config](apps/admin-next/src/i18n/request.ts)
[View locale types](apps/admin-next/src/i18n/index.ts)

---

### 5. AI-Powered Blog Image Translation

**Problem:** Blog articles contain images with embedded text in one language. When the article is viewed in a different locale, the image text becomes unreadable. Manual translation of images is impractical at scale.

**Solution:** An image translation engine using **Google Gemini AI** that detects text in images, translates it, and re-renders the image with translated text overlays. The translation progress is tracked per-article with a dedicated UI component.

[View image translation engine](apps/admin-next/src/components/blog/image-translation/ImageTranslationEngine.ts)
[View translation progress UI](apps/admin-next/src/views/blog/BlogTranslationProgress.tsx)

---

### 6. Real-Time Customer Service Chat

**Problem:** The customer service desk needs real-time messaging between agents and users, with typing indicators, message status tracking, and unread counts — all while maintaining connection resilience.

**Solution:** A Socket.IO-based chat system with automatic reconnection, message queuing for offline periods, and a dedicated [`useChatSocket`](apps/admin-next/src/hooks/useChatSocket.ts) hook that manages connection lifecycle, event subscriptions, and state synchronization.

[View chat components](apps/admin-next/src/components/customer-service)

---

## 📁 Project Structure

```
apps/admin-next/
├── src/
│   ├── app/                    # Next.js 15 App Router pages
│   │   ├── (dashboard)/        # Protected dashboard routes
│   │   │   ├── analytics/      # Analytics & charts (Recharts)
│   │   │   ├── finance/        # Deposits, withdrawals, transactions
│   │   │   ├── users/          # User management
│   │   │   ├── orders/         # Order management
│   │   │   ├── products/       # Product & flash sale management
│   │   │   ├── marketing/      # Coupons & promotions
│   │   │   ├── kyc/            # KYC verification
│   │   │   ├── blog/           # Blog CMS with AI translation
│   │   │   └── ...             # More modules
│   │   └── login/              # Public login page
│   ├── api/
│   │   └── http.ts             # Enterprise HttpClient (583 lines)
│   ├── components/
│   │   ├── layout/             # Dashboard layout, sidebar, header
│   │   ├── customer-service/   # Real-time chat components
│   │   ├── blog/               # Rich text editor, AI translation
│   │   ├── scaffold/           # Reusable table, pagination, search
│   │   └── ui/                 # SmartImage, etc.
│   ├── store/
│   │   ├── useAppStore.ts      # Theme, lang, sidebar (persisted)
│   │   ├── useAuthStore.ts     # Auth state, tokens, login/logout
│   │   └── useToastStore.ts    # Toast notifications
│   ├── hooks/                  # Custom React hooks
│   ├── i18n/                   # 6 language JSON files
│   ├── lib/                    # Utilities, cache helpers, Sentry
│   ├── schema/                 # Zod schemas for form validation
│   └── __tests__/              # 40+ test files
├── Dockerfile.prod             # Multi-stage Docker build
├── open-next.config.ts         # Cloudflare Pages config
└── vitest.config.ts            # Vitest configuration
```

---

## 🚀 Quick Start

```bash
# From monorepo root

# Install dependencies
yarn install

# Build shared dependencies first
yarn workspace @lucky/shared build
yarn workspace @repo/ui build

# Start dev server (port 4001)
yarn workspace @lucky/admin-next dev

# Or with Turbopack for faster HMR
yarn workspace @lucky/admin-next dev:turbo
```

### Environment

Copy the production env template:

```bash
cp apps/admin-next/.env.production apps/admin-next/.env.local
```

Key variables:

| Variable                   | Description                    |
| -------------------------- | ------------------------------ |
| `NEXT_PUBLIC_API_BASE_URL` | API base URL (default: `/api`) |
| `INTERNAL_API_URL`         | Internal API URL for SSR       |
| `NEXT_PUBLIC_DEPLOYED_AT`  | Build timestamp                |
| `NEXT_PUBLIC_GIT_SHA`      | Git commit SHA                 |

---

## 📦 Key Features

| Module               | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| **Dashboard**        | Analytics overview with charts (Recharts), KPIs, trends                       |
| **User Management**  | CRUD, search, filter, detail modals, login logs                               |
| **Order Management** | Order lifecycle, refund processing, status tracking                           |
| **Finance**          | Deposits, withdrawals, transactions, manual adjustments                       |
| **KYC Verification** | Document review, liveness check audit, approval workflow                      |
| **Blog CMS**         | Rich text editor (Markdown), categories, tags, comments, AI image translation |
| **Marketing**        | Coupon management, flash sales, lucky draws, promotions                       |
| **Customer Service** | Real-time chat with Socket.IO, conversation management                        |
| **Admin Users**      | RBAC with roles & permissions, audit logging                                  |
| **System Config**    | Dynamic configuration management                                              |
| **Products**         | Product CRUD, flash sale product binding                                      |
| **Banners & Ads**    | Banner management, ad placement                                               |
| **Groups**           | Group management with member administration                                   |
| **Notifications**    | Push notification management                                                  |
| **Payment Channels** | Payment gateway configuration                                                 |

---

## 🧪 Testing

```bash
# Run all unit tests
yarn workspace @lucky/admin-next test

# Watch mode
yarn workspace @lucky/admin-next test:watch

# Coverage report
yarn workspace @lucky/admin-next test:coverage

# E2E tests (Playwright)
yarn workspace @lucky/admin-next e2e

# Lighthouse performance audit
yarn workspace @lucky/admin-next lighthouse:audit
```

The test suite covers:

- **40+ test files** across components, views, store, API, and routes
- **Store tests**: Zustand state management (theme, auth, toast)
- **Component tests**: UI components, form validation, table rendering
- **View tests**: Dashboard, finance, users, orders, KYC, marketing, blog, and more
- **API tests**: HTTP client with mocked Axios
- **E2E tests**: Playwright for critical user flows
- **Performance**: Lighthouse CI with strict budgets

---

## 🔗 Related

- [Monorepo Root](../README.md) — Project overview and architecture
- [@lucky/api](../api/README.md) — NestJS backend API
- [@repo/ui](../packages/ui/README.md) — Shared UI component library
- [@lucky/shared](../packages/shared/README.MD) — Shared types and utilities

---

## 📄 License

Part of the Lucky Nest Monorepo. See the [root license](../README.md) for details.
