# Blog Articles Master Plan — Plans to Blog Integration

> Analysis Date: 2026-04-29
> Total Plans Analyzed: 48 files
> Existing Blog Articles: 44 published
> New Article Candidates: 14 proposals

## Methodology

Analyzed all 48 `.md` files in the `plans/` directory, cross-referenced against the 44 existing articles in `docs/blog/articles/` (organized under `architecture/`, `backend/`, `devops/`, `frontend/`, `performance/`, `security/`). Each plan was evaluated for:

1. **Depth of technical insight** — does it teach a transferable lesson?
2. **Uniqueness** — is this already covered by an existing article?
3. **General applicability** — would other developers benefit from reading it?

## High-Priority Candidates (10 articles)

These plans contain rich, transferable engineering lessons that are **not yet covered** by existing blog articles.

---

### 1. Middleware Regex → Full Production Outage

| Field | Detail |
|-------|--------|
| **Source Plan** | [`fix-app-build-manifest-404-plan.md`](plans/fix-app-build-manifest-404-plan.md) |
| **Category** | DevOps / Debugging |
| **Difficulty** | Intermediate |

**Why it's blog-worthy:**
A single regex change in `middleware.ts` (narrowing `_next` → `_next/static|_next/image`) caused three cascading failures:
- 404 on `/_next/app-build-manifest.json`
- PWA Service Worker `bad-precaching-response` → entire site broken
- 500/503 on article pages via `/_next/data/*` RSC payload interception

**Key lessons:**
- Third-party effects of middleware regex patterns
- How Next.js `_next/*` paths work (static, data, manifests)
- Workbox precache and why a 404 on any precached URL fails the entire SW install
- Debugging technique: tracing commit history to find `bfa25c6` → `7c33a68` → `c8bb1ab`

**Suggested title:** *一个 Middleware 正则引发的全站瘫痪：PWA + RSC 级联故障排查实录*

**Suggested path:** `docs/blog/articles/devops/nextjs-middleware-regex-production-outage.md`

---

### 2. Cloudflare Worker 3 MiB Size Limit: How Sentry + barrel imports broke the build

| Field | Detail |
|-------|--------|
| **Source Plan** | [`fix-admin-cloudflare-worker-size.md`](plans/fix-admin-cloudflare-worker-size.md) |
| **Category** | DevOps / Performance |
| **Difficulty** | Advanced |

**Why it's blog-worthy:**
The admin app's handler jumped to 11.14 MiB — 3.7× over Cloudflare's free plan 3 MiB limit. Root cause was a `static re-export` of `captureRequestError` from `@sentry/nextjs` that pulled in the entire OpenTelemetry/webpack toolchain.

**Key lessons:**
- Static re-exports vs dynamic `import()` and their bundle implications
- Sentry instrumentation and why `onRequestError` is dangerous for edge workers
- `framer-motion` in SSR contexts
- Barrel import patterns and `optimizePackageImports`
- The extreme constraints of Cloudflare Workers (3 MiB free, 10 MiB paid)

**Suggested title:** *11 MiB 到 2.8 MiB：Cloudflare Worker 体积极限优化实战*

**Suggested path:** `docs/blog/articles/devops/cloudflare-worker-size-optimization.md`

---

### 3. Gemini AI JSON Parsing: When LLMs Won't Obey Schema

| Field | Detail |
|-------|--------|
| **Source Plan** | [`fix-batch-translation-json-parsing-plan.md`](plans/fix-batch-translation-json-parsing-plan.md) |
| **Category** | Backend / AI |
| **Difficulty** | Intermediate |

**Why it's blog-worthy:**
`responseMimeType: 'application/json'` doesn't guarantee valid JSON output from Gemini when the `content` field contains Markdown with unescaped quotes and backslashes. The solution combines `repair-json.ts` (regex fixes) + a `fallbackTranslator` that splits into individual API calls.

**Key lessons:**
- LLM JSON output reliability limits
- JSON repair strategies (unterminated strings, trailing commas, single quotes)
- Circuit breaker / retry with fallback pattern
- Prompt engineering for structured output

**Suggested title:** *Gemini JSON 输出不听话？批量化翻译中的 JSON 修复实战*

**Suggested path:** `docs/blog/articles/backend/nestjs-gemini-json-repair.md`

---

### 4. Nginx CORS: The Safari `x-skip-auth-refresh` Case

| Field | Detail |
|-------|--------|
| **Source Plans** | [`nginx-cors-and-import-script-fix-plan.md`](plans/nginx-cors-and-import-script-fix-plan.md), [`nginx-deep-analysis.md`](plans/nginx-deep-analysis.md) |
| **Category** | DevOps / Security |
| **Difficulty** | Advanced |

**Why it's blog-worthy:**
Full login was broken on Safari/iPhone because a custom header `x-skip-auth-refresh` was missing from `Access-Control-Allow-Headers` in the CORS preflight response. Combined with `proxy_hide_header` double-header issues and dynamic `$http_origin` for the public blog API.

**Key lessons:**
- CORS preflight `OPTIONS` mechanics (Safari is stricter than Chrome)
- Custom header handling across Nginx → NestJS
- `proxy_hide_header` for deduplication
- `always` parameter for error-response CORS headers
- Dev vs prod nginx config differences

**Suggested title:** *Safari 登录不了？Nginx CORS 自定义 Header 踩坑记*

**Suggested path:** `docs/blog/articles/devops/nginx-cors-custom-headers-debug.md`

---

### 5. ISR Cache: From `dummy` to KV-Backed Incremental Static Regeneration

| Field | Detail |
|-------|--------|
| **Source Plan** | [`fix-blog-isr-caching-plan.md`](plans/fix-blog-isr-caching-plan.md) |
| **Category** | Performance / DevOps |
| **Difficulty** | Intermediate |

**Why it's blog-worthy:**
The blog had `incrementalCache: 'dummy'` meaning every request triggered full SSR — wasting the `revalidate: 60` and `revalidate: 3600` exports. The fix uses OpenNext's built-in KV incremental cache module with zero custom code.

**Key lessons:**
- Next.js ISR + `revalidate` time semantics on Cloudflare Workers
- OpenNext KV incremental cache architecture
- KV binding naming conventions (`NEXT_INC_CFG_CACHE_KV`, `NEXT_INC_CACHE_KV`)
- Tag cache vs incremental cache
- Performance: 2s SSR → 80ms cache-hit

**Suggested title:** *从 2 秒到 80 毫秒：Cloudflare KV + ISR 缓存实战*

**Suggested path:** `docs/blog/articles/performance/nextjs-isr-kv-cache.md`

---

### 6. PWA on Next.js App Router + Cloudflare Workers

| Field | Detail |
|-------|--------|
| **Source Plan** | [`fix-pwa-not-working-cloudflare-plan.md`](plans/fix-pwa-not-working-cloudflare-plan.md) |
| **Category** | Frontend / DevOps |
| **Difficulty** | Intermediate |

**Why it's blog-worthy:**
`next-pwa` v5.6.0 can't inject `<link rel="manifest">` into App Router layouts — only works with Pages Router's `_document.tsx`. The fix required manual `<link>` tag injection + SW registration in `layout.tsx`.

**Key lessons:**
- next-pwa + App Router compatibility
- PWA manifest discovery mechanism
- Locale-specific manifests via `manifest-loader.ts`
- Workbox precache and SW lifecycle
- OpenNext asset handling for `sw.js`

**Suggested title:** *Next.js App Router + Cloudflare：PWA 手动适配踩坑指南*

**Suggested path:** `docs/blog/articles/frontend/nextjs-pwa-app-router-cloudflare.md`

---

### 7. Client-Side Markdown Import: Replacing Server File Scan with Browser FileReader

| Field | Detail |
|-------|--------|
| **Source Plan** | [`client-side-markdown-import-plan.md`](plans/client-side-markdown-import-plan.md) |
| **Category** | Frontend |
| **Difficulty** | Intermediate |

**Why it's blog-worthy:**
A complete architecture shift: instead of the server reading markdown files from disk (limited by 2 GB RAM server), the browser reads `.md` files via `<input type=file>` + `FileReader.readAsText()`, parses YAML frontmatter client-side, then imports via existing batch API.

**Key lessons:**
- Browser File API patterns for markdown import
- Client-side YAML frontmatter parsing
- Drag-and-drop UX for file import
- Architecture migration: server → client processing
- No backend changes needed

**Suggested title:** *服务器只有 2G 内存怎么办？浏览器端 Markdown 文件导入方案*

**Suggested path:** `docs/blog/articles/frontend/client-side-markdown-import.md`

---

### 8. CI/CD Reusable Workflows in a Monorepo

| Field | Detail |
|-------|--------|
| **Source Plan** | [`ci-cd-reusable-config.md`](plans/ci-cd-reusable-config.md) |
| **Category** | DevOps |
| **Difficulty** | Advanced |

**Why it's blog-worthy:**
Two GitHub Actions workflows and two GitLab CI configs had 80% identical steps (checkout, node setup, yarn install, shared builds, Cloudflare deploy, Telegram notifications). The plan identifies exactly what can be extracted into reusable workflows.

**Key lessons:**
- GitHub Actions reusable workflow design
- GitLab CI hidden job templates
- Monorepo-specific CI optimization (workspace targeting, cache key design)
- Deploying 3 apps to Cloudflare from a single monorepo
- Duplication vs abstraction tradeoffs

**Suggested title:** *Monorepo CI/CD 复用实战：从 4 个 YAML 到 1 个 Reusable Workflow*

**Suggested path:** `docs/blog/articles/devops/monorepo-ci-reusable-workflow.md`

---

### 9. Google OAuth + Cloudflare + Nginx: The Cross-Domain Auth Flow

| Field | Detail |
|-------|--------|
| **Source Plans** | [`fix-google-oauth-404.md`](plans/fix-google-oauth-404.md), [`jwt-invalid-signature-root-cause-analysis.md`](plans/jwt-invalid-signature-root-cause-analysis.md) |
| **Category** | Security / DevOps |
| **Difficulty** | Advanced |

**Why it's blog-worthy:**
Two separate OAuth issues: (1) OAuth redirect to relative path on Cloudflare domain instead of absolute API domain, and (2) dev/prod JWT secret mismatch causing `invalid signature` because Google redirect went to production server.

**Key lessons:**
- Cloudflare Pages vs Nginx domain routing for OAuth
- JWT secret management across environments
- Dev nginx config vs prod nginx config for OAuth paths
- Redirect URI design for multi-domain architectures
- Debugging cross-environment auth flows

**Suggested title:** *跨域 OAuth 的九九八十一难：Cloudflare + Nginx + JWT 连环坑*

**Suggested path:** `docs/blog/articles/security/oauth-cross-domain-cloudflare-nginx.md`

---

### 10. Admin Preview ≠ Frontend: The WYSIWYG Gap

| Field | Detail |
|-------|--------|
| **Source Plan** | [`admin-preview-matches-frontend-plan.md`](plans/admin-preview-matches-frontend-plan.md) |
| **Category** | Frontend |
| **Difficulty** | Beginner |

**Why it's blog-worthy:**
A common CMS problem: the admin preview looks different from the published frontend. Covers typography (`text-3xl` → `text-5xl`), missing tags display, missing metadata (views, likes, comments), and prose styling differences.

**Key lessons:**
- Admin preview ↔ public frontend visual consistency
- Typography scaling across viewports
- Prose class mapping
- Content preview rendering architecture

**Suggested title:** *WYSIWYG 陷阱：Admin 预览和前端详情页的视觉一致性方案*

**Suggested path:** `docs/blog/articles/frontend/admin-preview-visual-consistency.md`

---

## Medium Priority (4 articles)

These are solid but narrower in scope.

### 11. Adding Locales to a Running App (fr/de)

| Source Plans | Category |
|--------------|----------|
| [`fix-fr-de-404-plan.md`](plans/fix-fr-de-404-plan.md), [`fix-fr-de-tabs-showing-chinese-plan.md`](plans/fix-fr-de-tabs-showing-chinese-plan.md) | i18n |

Adding French and German to an existing 4-locale app: `LOCALES` array, message files, locale metadata, middleware regex, DB migration for `LocalizedString`.

### 12. iOS Safari Overscroll Bug

| Source Plan | Category |
|-------------|----------|
| [`fix-ios-bottom-nav-gap-plan.md`](plans/fix-ios-bottom-nav-gap-plan.md) | Frontend / Mobile |

CSS `overscroll-behavior: contain` vs `auto`, `backdrop-blur` transparency effects, rubber-band overscroll on fixed elements.

### 13. Monorepo Decomposition: Extracting Blog Admin

| Source Plan | Category |
|-------------|----------|
| [`extract-blog-admin-from-admin-next.md`](plans/extract-blog-admin-from-admin-next.md) | Architecture |

Splitting a megasized Next.js app into two Cloudflare Workers to bypass the 3 MiB limit. Shared auth, same API, separate deployments.

### 14. Compression Optimization on Cloudflare Edge

| Source Plan | Category |
|-------------|----------|
| [`optimize-blog-compression-plan.md`](plans/optimize-blog-compression-plan.md) | Performance |

Brotli pre-compression redundancy on Cloudflare Workers (edge already does zstd/Brotli), Terser optimization passes, `drop_console`, undeclared dependencies.

---

## Not Recommended for Blog Articles (24 files)

| Plan | Reason |
|------|--------|
| `fix-admin-editor-scroll-to-top-plan.md` | Very specific editor scroll bug, low general interest |
| `fix-exhaustive-deps-plan.md` | Standard React ESLint fix, not blog-worthy |
| `fix-admin-blog-lint-errors-plan.md` | Standard lint cleanup |
| `sidebar-icons-plan.md` | Trivial UI change |
| `blog-settings-isolation.md` | Internal refactoring, no general lesson |
| `decouple-admin-next-locale-from-blog-translation-plan.md` | Very specific i18n refactoring |
| `translation-audit-plan.md` | Single missing key, too narrow |
| `fix-article-back-404-plan.md` | Specific route fix |
| `fix-preview-404-plan.md` | Preview route fix |
| `fix-frontend-blog-csdn-style-plan.md` | CSS styling only |
| `fix-hydration-error-plan.md` | Browser cache issue, resolved |
| `fix-next-intl-context-not-found-plan.md` | Dev environment issue |
| `server-scan-markdown-files-plan.md` | Superseded by client-side import plan |
| `admin-blog-ci-optimize-plan.md` | Admin-specific CI tweaks |
| `admin-blog-eslint-fix-plan.md` | Admin-specific lint fix |
| `admin-blog-import-ui-plan.md` | Admin component refactoring |
| `admin-blog-navigation-restructure.md` | Admin navigation |
| `copy-admin-next-settings-to-blog.md` | One-time migration |
| `delete-admin-next-blog-plan.md` | Cleanup after extraction |
| `fix-admin-blog-i18n-keys.md` | Admin-specific i18n |
| `fix-admin-i18n-keys-definitive.md` | Same as above |
| `fix-all-ci-lint-errors-plan.md` | CI lint fix, too narrow |
| `fix-edit-imported-articles-plan.md` | Specific editor bug |
| `fix-frontend-blog-pre-existing-errors.md` | Pre-existing issues list |

---

## Summary

| Priority | Count | Articles |
|----------|-------|----------|
| **High** | 10 | Middleware outage, Worker size, Gemini JSON, Nginx CORS, ISR KV cache, PWA App Router, Client Markdown, CI/CD reusable, OAuth cross-domain, Admin preview |
| **Medium** | 4 | Add locales, iOS overscroll, Extract blog admin, Compression optimization |
| **Not recommended** | 24 | Too narrow, admin-specific, or standard fixes |
| **Already published** | ~10 | Plans that overlap with existing articles |

**Total blog-worthy new articles possible: 14 out of 48 plans (29%)**
