# Upwork Portfolio Projects — Condensed Versions (<600 chars each)

---

## Project 1: JoyMini API — NestJS Backend Platform (575 chars)

**Title:** JoyMini API — NestJS Production Backend Platform
**Role:** Solo Architect & Developer
**URL:** https://blog.joyminis.com
**Skills:** NestJS, TypeScript, PostgreSQL, Prisma ORM, Redis, BullMQ, WebSocket, JWT, OAuth 2.0
**Description:**
Production backend (NestJS + PostgreSQL + Redis + BullMQ) powering payment, IM, auth, and e-commerce for a live cross-platform app suite. Built end-to-end payment pipeline with Xendit — zero double-charge incidents. Architected real-time IM via Socket.io with seqId cursor pagination and WebRTC calls. Implemented 5-provider OAuth (Google/Apple/Facebook/GitHub/Firebase) with JWT rotation, RBAC, and reCAPTCHA. Designed BullMQ queue for AI translation (Gemini) and media processing. Built KYC with AWS Rekognition + Gemini AI fallback.

---

## Project 2: JoyMini Admin — Next.js Admin Dashboard (~580 chars)

**Title:** JoyMini Admin — Next.js Enterprise Admin Dashboard
**Role:** Solo Architect & Developer
**URL:** https://admin.joyminis.com
**Skills:** Next.js, React, TypeScript, TanStack Table, TanStack Query, Tailwind CSS, Zustand
**Description:**
Enterprise admin dashboard (Next.js 15 App Router) with 15+ management modules covering finance, KYC, customer service chat, orders, coupons, and system config. Built reusable SchemaSearchForm + TanStack Table pattern across all modules. Designed caching contract pattern unifying URL params, API queries, and React Query keys. Implemented typed API client (19 modules, 1,145 lines) with 401 auto-refresh and Sentry tracing. Achieved Lighthouse 98+ via dynamic imports (40% bundle reduction) and ISR caching.

---

## Project 3: JoyMini Flutter — Cross-Platform Super App (~580 chars)

**Title:** JoyMini Flutter — Cross-Platform Super App
**Role:** Solo Architect & Developer
**URL:** https://app.joyminis.com
**Skills:** Flutter, Dart, Riverpod, GoRouter, WebRTC, Dio, Firebase Cloud Messaging, CustomPainter
**Description:**
iOS/Android/Web super app with real-time chat, e-commerce, wallet, KYC, and WebRTC voice/video calls. Engineered 60fps IM scrolling via ItemPositionsListener with zero layout shift. Eliminated OOM crashes on low-end Android via Web sandbox for ML SDK. Achieved 100% payment conversion via Dart conditional compilation bridges. Built 60fps lucky draw wheel with Canvas CustomPainter. Implemented dual-Dio architecture with single-flight token refresh. Sub-second cold boot via background SQLite hydration.

---

## Project 4: JoyMini Blog — Multi-Language Blog Platform (~580 chars)

**Title:** JoyMini Blog — Multi-Language Blog Platform with AI Translation
**Role:** Solo Architect & Developer
**URL:** Blog: https://blog.joyminis.com | CMS: https://blog-admin.joyminis.com
**Skills:** Next.js, TypeScript, Cloudflare Workers, PWA, i18n, Gemini AI, PostgreSQL
**Description:**
Dual-app blog ecosystem (Next.js + Cloudflare Workers) serving 114+ articles in 6 languages. Built AI translation pipeline via BullMQ + Gemini with exponential backoff and 1-hour TTL cache. Implemented JSONB LocalizedString pattern for 6-language content. Achieved Lighthouse 98+ (LCP < 1s, TTFB < 200ms). Built 100% offline PWA with 3-layer cache (IndexedDB, Service Worker, Worker KV). HTTP 103 Early Hints reducing latency by 200-500ms. Authored 114+ technical articles on full-stack architecture.
- Built real-time customer service chat desk with WebSocket-driven message delivery and seqId cursor pagination
- Achieved Lighthouse 98+ via dynamic imports (40% bundle reduction), ISR caching, and Framer Motion page transitions
- Integrated RBAC route guards, ImageKit media upload, and Zustand SSR-hydration auth store

---

## Project 3: Flutter App — Cross-Platform Mobile Application

**Project title:** JoyMini Flutter — Cross-Platform Super App

**Your role:** Solo Architect & Developer

**Project URL:** https://app.joyminis.com

**Skills:** Flutter, Dart, Riverpod, GoRouter, WebRTC, Firebase Cloud Messaging, Dio, CustomPainter, FFmpeg, CallKit

**Project description:**
iOS/Android/Web cross-platform super app with real-time chat, e-commerce, wallet/fintech, KYC identity verification, WebRTC voice/video calling, and group buying/lucky draw. Architected with production-grade patterns for 60fps performance and offline resilience.

Key achievements:
- Engineered 60fps viewport-aware IM pagination (ItemPositionsListener) with zero Cumulative Layout Shift across thousands of messages
- Eliminated OOM crashes on low-end Android via isolated Web sandboxes for AWS ML Liveness SDK + postMessage secure bridging
- Achieved 100% payment conversion across iOS/Android/Web via Dart conditional compilation bridges for Xendit
- Engineered 60fps lucky draw wheel using raw Canvas CustomPainter — reduced 100+ widget nodes to single GPU draw instruction
- Implemented dual-Dio HTTP architecture with QueuedInterceptor (5-strategy error dispatch) and single-flight token refresh preventing race conditions
- Guaranteed message delivery under weak networks via ConnectivityManager + SQLite offline queue with exponential backoff retry (<500ms queue flush on reconnection)
- Achieved sub-second cold boot via background SQLite hydration before first frame render

---

## Project 4: Blog Ecosystem — Technical Documentation CMS + Public Blog

**Project title:** JoyMini Blog — Multi-Language Blog Platform with AI Translation

**Your role:** Solo Architect & Developer

**Project URL:** Blog: https://blog.joyminis.com | CMS: https://blog-admin.joyminis.com

**Skills:** Next.js, TypeScript, Cloudflare Workers, PWA, i18n, MDX, Gemini AI, BullMQ, PostgreSQL

**Project description:**
Dual-app blog ecosystem: NestJS API (30+ endpoints, 3754-line service) + Next.js public blog (SSR/ISR hybrid rendering, deployed on Cloudflare Workers via OpenNext) + Next.js admin CMS — serving 114+ published technical articles in 6 languages.

Key achievements:
- Built AI-powered translation pipeline via BullMQ + Gemini AI: multi-provider abstraction, exponential backoff with random jitter, 1-hour TTL translation cache, event-driven full locale retranslation
- Implemented PostgreSQL JSONB LocalizedString pattern for 6-language content (zh/en/ja/ko/fr/de) with automatic legacy field fallback
- Achieved Lighthouse 98+ via 26 cross-dimension optimizations: LCP < 1s, TTFB < 200ms (CDN cached)
- Implemented 100% offline PWA with 3-layer cache (IndexedDB, Service Worker, Worker KV)
- Built HTTP 103 Early Hints warming CDN + API connections, reducing first-visit latency by 200-500ms
- Authored 114+ in-depth technical articles covering full-stack architecture, DevOps, and AI integration
