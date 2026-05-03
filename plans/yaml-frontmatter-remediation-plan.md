# YAML Frontmatter Remediation Plan — Remaining Phases

## Context

All blog articles in `docs/blog/articles/` must have valid YAML frontmatter (`title`, `slug`, `description`, `tags`) for `parseFrontmatter()` to work correctly. Phases 1-3 (admin/, admin-next/, security/ — 16 articles) are complete. This plan covers the remaining ~55 articles.

**Critical rule**: ALL content must stay in its original language (Chinese preserved as Chinese, English preserved as English). Only YAML frontmatter is added/modified.

## Article State Categories

| Category | Description | Count |
|----------|-------------|-------|
| **A** | No YAML frontmatter at all — need full YAML | ~7 |
| **B** | Partial YAML — has `tags` only, missing `title`/`slug`/`description` | ~8 |
| **C** | Partial YAML — has `title`/`slug`/`tags`, missing `description` | ~35 |
| **D** | Partial YAML — has `title`/`description`/`tags`, missing `slug` | ~5 |

## Phase 4: api/ — 3 remaining (Type A)

| # | File | Title | Tags |
|---|------|-------|------|
| 1 | `api/security-toolchain-otp-throttler-xss-recaptcha.md` | 安全工具链：OTP 限流器、XSS 清洗与 reCAPTCHA 验证 | NestJS, Security, Throttler, XSS, reCAPTCHA, OTP |
| 2 | `api/webrtc-call-signaling-chat-dto.md` | WebRTC 通话信令与聊天 DTO 架构：NestJS 实时通信 | NestJS, Socket.IO, WebRTC, Call Signaling, Chat, DTO, Swagger, TypeScript |
| 3 | `api/websocket-gateway-event-emitter-architecture.md` | API WebSocket 实时通信 — Gateway + EventEmitter 事件分发架构 | NestJS, WebSocket, Socket.IO, EventEmitter, Real-time, Architecture |

## Phase 5a: architecture/ — 7 articles (Types A/B/C)

| # | File | Current State | Needed |
|---|------|---------------|--------|
| 1 | `nestjs-backend-architecture-deep-dive.md` | ✅ title, slug, tags | ➕ description |
| 2 | `nestjs-blog-backend-architecture.md` | ❌ No YAML (inline `Tags:` format) | ➕ full YAML |
| 3 | `nestjs-nextjs-i18n-architecture.md` | ⚠️ tags only | ➕ title, slug, description |
| 4 | `nestjs-websocket-im-customer-service.md` | ✅ title, slug, tags | ➕ description |
| 5 | `nextjs-platform-adapter-pattern.md` | ❌ No YAML (inline `Tags:` format) | ➕ full YAML |
| 6 | `react-hooks-architecture-nextjs.md` | ⚠️ tags only | ➕ title, slug, description |
| 7 | `typescript-monorepo-three-tier-tsconfig.md` | ✅ title, slug, tags | ➕ description |

## Phase 5b: backend/ — 5 articles (Type D)

| # | File | Current State | Needed |
|---|------|---------------|--------|
| 1 | `nestjs-finance-audit-xendit.md` | ✅ title, description, tags | ➕ slug |
| 2 | `nestjs-gemini-ai-circuit-breaker.md` | ✅ title, description, tags | ➕ slug |
| 3 | `nestjs-order-payment-pipeline.md` | ✅ title, description, tags | ➕ slug |
| 4 | `nestjs-wallet-optimistic-locking.md` | ✅ title, description, tags | ➕ slug |
| 5 | `nestjs-webrtc-signaling-gateway.md` | ✅ title, description, tags | ➕ slug |

## Phase 5c: devops/ — 6 articles (Types B/C)

| # | File | Current State | Needed |
|---|------|---------------|--------|
| 1 | `cloudflare-queue-isr-troubleshooting.md` | ⚠️ tags only | ➕ title, slug, description |
| 2 | `nextjs-gitlab-ci-migration.md` | ⚠️ tags only | ➕ title, slug, description |
| 3 | `nextjs-lighthouse-ci-integration.md` | ⚠️ tags only | ➕ title, slug, description |
| 4 | `nextjs-prisma-v6-migration.md` | ⚠️ tags only | ➕ title, slug, description |
| 5 | `nextjs-sentry-lhci-monitoring.md` | ✅ title, slug, tags | ➕ description |
| 6 | `ssg-ssr-isr-cloudflare-complete-guide.md` | ⚠️ tags only | ➕ title, slug, description |

## Phase 6: frontend/ — 29 articles (mostly Type C)

Sampled articles show most have `title`/`slug`/`tags` but are **missing `description`**. Each needs a Chinese description added. Full list:

1. `admin-blog-form-architecture.md` — verify/complete
2. `admin-blog-localized-form.md` — verify/complete
3. `admin-blog-localized-rendering.md` — verify/complete
4. `admin-blog-rich-text-editor.md` — verify/complete
5. `admin-blog-translation-issues.md` — verify/complete
6. `admin-blog-translation-progress.md` — verify/complete
7. `blog-ai-multilingual-translation.md` — has title/slug/tags, missing description
8. `blog-nextjs-seo-technical-implementation.md` — verify/complete
9. `blog-three-in-one-login-system.md` — verify/complete
10. `blog-video-hls-transcoding-practice.md` — verify/complete
11. `blog-xss-content-sanitization-practice.md` — verify/complete
12. `blurhash-image-ssr-safe.md` — verify/complete
13. `cloudflare-103-early-hints.md` — verify/complete
14. `homepage-extreme-optimization.md` — verify/complete
15. `nextjs-auth-zero-flicker.md` — has title/slug/tags, missing description
16. `nextjs-blog-bookmark-system.md` — verify/complete
17. `nextjs-blog-comment-system.md` — verify/complete
18. `nextjs-blog-loading-optimization.md` — verify/complete
19. `nextjs-language-zero-flicker.md` — verify/complete
20. `nextjs-page-transition-animation.md` — verify/complete
21. `nextjs-pwa-installable-offline-blog.md` — verify/complete
22. `nextjs-rendering-modes-guide.md` — verify/complete
23. `nextjs-ssr-seo-crawler-master-guide.md` — verify/complete
24. `nextjs-universal-fetcher.md` — verify/complete
25. `nextjs-zero-skeleton-optimization.md` — verify/complete
26. `react-hls-cross-component-coordination.md` — verify/complete
27. `react-query-platform-adapter.md` — verify/complete
28. `zustand-cookie-storage-ssr-auth.md` — verify/complete

## Phase 7: performance/ — 3 articles (Types A/C)

| # | File | Current State | Needed |
|---|------|---------------|--------|
| 1 | `nextjs-admin-ssr-ux-optimization.md` | ✅ title, slug, tags | ➕ description |
| 2 | `nextjs-bundle-size-optimization-practice.md` | ❌ No YAML (inline `Tags:` format) | ➕ full YAML |
| 3 | `yarn-pnp-monorepo-ci-caching.md` | ❌ No YAML (inline `Tags:` format) | ➕ full YAML |

## Final Verification

- Verify flutter/ (23 articles) — samples show complete YAML ✅
- Verify projects/ (4 articles) — samples show complete YAML ✅
- Run a scan across ALL `docs/blog/articles/**/*.md` files to confirm valid frontmatter

## Approach

For each article:
1. **Read the first 10-15 lines** to determine current state and extract title/tags
2. **Use `apply_diff`** to prepend missing YAML fields or add full YAML block before existing content
3. **Slug must match filename** (without `.md` extension)
4. **Description is a 1-2 line Chinese summary** extracted from content

## CI/Testing Strategy

After all phases, run:
```
grep -rl '^---$' docs/blog/articles/ | wc -l  # count articles with frontmatter
grep -l '^description:' docs/blog/articles/**/*.md | wc -l  # count with description
```
