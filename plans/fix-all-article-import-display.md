# Article Import Display Fix — All Categories

> **Problem**: Admin blog articles also don't display fully, same root cause as Flutter articles.
> **Root Cause**: Missing/incomplete YAML frontmatter, Chinese titles, Chinese prose, Chinese code comments.

---

## Inventory Summary

### Category A: No YAML Frontmatter (Critical — can't extract tags/slug/excerpt)

| Directory | Count | Articles |
|-----------|-------|----------|
| `admin/` | 7 | data-synchronizer, http-client-auth-refresh-retry, middleware-jwt-route-guard, sentry-observability-span-utils, smart-table-generic-data-grid, use-chat-socket, zustand-auth-store |
| `admin-next/` | 3 | api-client-layer-30-modules, cache-contract-pattern-15-modules, security-utils-zod-pii-xss |
| `api/` | 21 | All 21 api articles (use `**Date:**`/`**Tags:**` format instead of YAML) |
| `security/` | 3 | ai-comment-moderation-gemini, nestjs-like-deduplication-guard, nestjs-sensitive-word-filter |

### Category B: Incomplete YAML Frontmatter (has YAML block but missing required fields)

| Directory | Count | Issue |
|-----------|-------|-------|
| `security/` | 3 | nestjs-recaptcha-v3-integration (tags only), nestjs-jwt-permission-system (tags only), nestjs-device-fingerprint-antifraud (has all fields but Chinese title) |

### Category C: Has YAML Frontmatter But Chinese Title + Prose

| Directory | Count | Notes |
|-----------|-------|-------|
| `architecture/` | 7 | Have YAML with Chinese titles, Chinese prose |
| `backend/` | 5 | Have YAML with Chinese titles, Chinese prose |
| `devops/` | 6 | Have YAML with Chinese titles, Chinese prose |
| `frontend/` | 29 | Have YAML with Chinese titles, Chinese prose |
| `performance/` | 3 | Have YAML with Chinese titles, Chinese prose |

### Category D: Has Complete YAML + English (OK — no changes needed)

| Directory | Count | Notes |
|-----------|-------|-------|
| `projects/` | 4 | English titles, YAML present |

**Total articles needing fixes: ~77**

---

## Remediation Plan

### Phase 1: admin/ articles (7 articles) — PRIORITY
The user specifically reported admin/ articles as broken.

**Action per article:**
1. Add YAML frontmatter (`title`, `slug`, `tags`, `description`)
2. Translate Chinese titles to English (both YAML `title` and `# Title` heading)
3. Translate Chinese prose to English
4. Translate Chinese code comments to English
5. Translate Chinese UI/error strings in code blocks
6. Translate Chinese diagram labels
7. Replace Chinese metadata quote blocks (`> **难度**: ⭐⭐⭐⭐`) with natural-language English `description`

**Articles by complexity:**
- **Simple fix** (mainly YAML + title): `http-client-auth-refresh-retry.md` (722L, mostly English), `smart-table-generic-data-grid.md` (706L, mostly English)
- **Full fix needed**: `data-synchronizer-deep-compare-cycle-safe.md` (378L), `middleware-jwt-route-guard.md` (379L), `sentry-observability-span-utils.md` (266L), `use-chat-socket-realtime-customer-service.md` (456L), `zustand-auth-store-ssr-hydration.md` (344L)

### Phase 2: admin-next/ articles (3 articles)
Fixes are the same pattern as Phase 1. All three have Chinese prose.

- `api-client-layer-30-modules.md` (236L)
- `cache-contract-pattern-15-modules.md` (302L)
- `security-utils-zod-pii-xss.md` (244L)

### Phase 3: security/ articles with no/incomplete YAML (6 articles)
- 3x add full YAML frontmatter + translation: `ai-comment-moderation-gemini.md` (240L), `nestjs-like-deduplication-guard.md` (300L), `nestjs-sensitive-word-filter.md` (320L)
- 3x add missing YAML fields + title translation: `nestjs-recaptcha-v3-integration.md` (333L), `nestjs-jwt-permission-system.md` (417L), `nestjs-device-fingerprint-antifraud.md` (322L)

### Phase 4: api/ articles (21 articles)
All 21 articles lack YAML frontmatter. Each needs:
1. YAML frontmatter with `title`, `slug`, `tags`, `description`
2. Chinese title → English translation
3. Chinese prose → English translation
4. Code comment/string translation

**File list:** ai-powered-translation-engine, ai-service-migration-vertex-ai-to-ai-studio, avatar-service-payment-cache-interceptor, blog-security-like-dedup-sensitive-word, bullmq-background-jobs-queue-architecture, csrf-double-middleware-protection, device-security-risk-control, email-resend-notification-service, file-upload-cloudflare-r2-media-processing, generic-dto-system-transforms-pagination, group-service-redis-lock-settlement, kyc-provider-aws-rekognition-vertex-ai, language-detection-service-franc-min, lucky-draw-service-lottery-ticket, media-processing-pipeline-sharp-hls, nestjs-guards-interceptors-pipes-filters, queue-monitor-bullmq-dashboard, redis-distributed-lock-system, security-toolchain-otp-throttler-xss-recaptcha, webrtc-call-signaling-chat-dto, websocket-gateway-event-emitter-architecture

### Phase 5: architecture/, backend/, devops/ articles with YAML + Chinese titles (18 articles)
These already have YAML frontmatter but with Chinese titles and Chinese prose. Fix scope:
1. Translate YAML `title` to English
2. Translate `# Title` heading to English
3. Translate Chinese prose to English
4. Translate code comments/strings/diagrams

### Phase 6: frontend/ articles (29 articles)
Same as Phase 5 — have YAML with Chinese titles + prose. Largest batch, may need to be split into sub-phases.

### Phase 7: performance/ articles (3 articles)
Same pattern — have YAML with Chinese titles + prose.

---

## Fix Pattern (per article)

For each article in the order above:

```diff
+ ---
+ title: English Article Title
+ slug: article-slug-matches-filename
+ tags: Tag1, Tag2, Tag3
+ description: Natural language 1-2 sentence summary in English
+ ---
+ 
+ # English Article Title
+ 
- Previous Chinese/English content starts here...
+ Translated English content (with Chinese prose → English, Chinese code comments → English)
```

### What to translate:
1. **YAML frontmatter**: Add `title` (English), `slug` (from filename), `tags` (existing tags), `description` (English summary)
2. **Title**: `# Chinese Title` → `# English Title`
3. **Prose**: All Chinese prose → English
4. **Code comments**: Any Chinese comments inside code blocks → English
5. **UI strings / error messages**: In code blocks, `'中文错误'` → `'English error'`
6. **Diagram labels**: In ASCII/Unicode diagrams, Chinese labels → English
7. **Metadata blocks**: Remove `> **难度**: ⭐⭐⭐⭐` etc. — these become excerpt via fallback parser
8. **Comparison tables**: Chinese table content → English

### What NOT to change:
- Code blocks (except comments and UI strings)
- File references and links
- Structure and formatting

---

## Execution Order

| Phase | Directory | Articles | Priority | Reason |
|-------|-----------|----------|----------|--------|
| 1 | `admin/` | 7 | 🔴 Highest | User-reported issue |
| 2 | `admin-next/` | 3 | 🔴 High | Same architecture as admin |
| 3 | `security/` | 6 | 🟠 Medium | No/incomplete YAML |
| 4 | `api/` | 21 | 🟠 Medium | No YAML frontmatter |
| 5 | `architecture/backend/devops/` | 18 | 🟡 Lower | Have YAML but Chinese titles |
| 6 | `frontend/` | 29 | 🟡 Lower | Have YAML but Chinese titles |
| 7 | `performance/` | 3 | 🟡 Lower | Have YAML but Chinese titles |

Total articles: ~77
