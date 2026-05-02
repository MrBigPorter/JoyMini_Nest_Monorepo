# Plan: Translate 24 English Blog Articles to Chinese

## Objective

Translate all 24 English blog articles under `docs/blog/articles/` to Chinese, matching the style and format of existing Chinese articles (e.g., [`docs/blog/articles/frontend/nextjs-auth-zero-flicker.md`](docs/blog/articles/frontend/nextjs-auth-zero-flicker.md)).

## Translation Rules

Based on analysis of existing Chinese vs English articles, adhere to these rules:

1. **Prose text** → Translate to Chinese (paragraphs, descriptions, explanations)
2. **Code blocks** → Keep as-is (no translation inside code fences)
3. **File paths & URLs** → Keep as-is (e.g., [`apps/admin-next/src/lib/security-utils.ts`](apps/admin-next/src/lib/security-utils.ts))
4. **Technical terms** → Keep in English for proper nouns (NestJS, Redis, WebRTC, BullMQ, Dio, Flutter, Prisma, etc.)
5. **Mermaid/ASCII diagrams** → Keep as-is (diagram syntax is language-agnostic)
6. **Table content** → Translate headers and cell content to Chinese
7. **Frontmatter** (if any) → Translate `title` and `tags` to Chinese, keep `slug` as-is
8. **Metadata blocks** ( `> **Audience:**` / `> **Tag:**` / `> **Difficulty:**` / `> **Estimate:**` ) → Translate label text to Chinese, keep values in English
9. **Date/Tags/Code Reference headers** (api articles) → Translate to Chinese equivalents
10. **Headings** → Translate to Chinese
11. **Image alt text** → Translate to Chinese
12. **Inline code** (`code`) → Keep as-is
13. **Links** → Keep href as-is, translate display text to Chinese
14. **Blockquotes** → Translate content to Chinese

## Article Inventory (24 total)

### Batch 1: `admin-next/` (3 articles, ~782 total lines)
| # | File | Size |
|---|------|------|
| 1 | [`docs/blog/articles/admin-next/security-utils-zod-pii-xss.md`](docs/blog/articles/admin-next/security-utils-zod-pii-xss.md) | 244 lines |
| 2 | [`docs/blog/articles/admin-next/cache-contract-pattern-15-modules.md`](docs/blog/articles/admin-next/cache-contract-pattern-15-modules.md) | 302 lines |
| 3 | [`docs/blog/articles/admin-next/api-client-layer-30-modules.md`](docs/blog/articles/admin-next/api-client-layer-30-modules.md) | 236 lines |

### Batch 2: `api/` (8 articles, ~3,560 total lines)
| # | File | Size |
|---|------|------|
| 4 | [`docs/blog/articles/api/ai-powered-translation-engine.md`](docs/blog/articles/api/ai-powered-translation-engine.md) | 483 lines |
| 5 | [`docs/blog/articles/api/ai-service-migration-vertex-ai-to-ai-studio.md`](docs/blog/articles/api/ai-service-migration-vertex-ai-to-ai-studio.md) | 572 lines |
| 6 | [`docs/blog/articles/api/avatar-service-payment-cache-interceptor.md`](docs/blog/articles/api/avatar-service-payment-cache-interceptor.md) | 586 lines |
| 7 | [`docs/blog/articles/api/device-security-risk-control.md`](docs/blog/articles/api/device-security-risk-control.md) | 433 lines |
| 8 | [`docs/blog/articles/api/email-resend-notification-service.md`](docs/blog/articles/api/email-resend-notification-service.md) | 212 lines |
| 9 | [`docs/blog/articles/api/redis-distributed-lock-system.md`](docs/blog/articles/api/redis-distributed-lock-system.md) | 329 lines |
| 10 | [`docs/blog/articles/api/security-toolchain-otp-throttler-xss-recaptcha.md`](docs/blog/articles/api/security-toolchain-otp-throttler-xss-recaptcha.md) | 486 lines |
| 11 | [`docs/blog/articles/api/webrtc-call-signaling-chat-dto.md`](docs/blog/articles/api/webrtc-call-signaling-chat-dto.md) | 459 lines |

### Batch 3: `flutter/` (13 articles, ~10,325 total lines)
| # | File | Size |
|---|------|------|
| 12 | [`docs/blog/articles/flutter/api-cache-manager-dual-storage-swr.md`](docs/blog/articles/flutter/api-cache-manager-dual-storage-swr.md) | 449 lines |
| 13 | [`docs/blog/articles/flutter/app-bootstrap-data-barrier-parallel-init.md`](docs/blog/articles/flutter/app-bootstrap-data-barrier-parallel-init.md) | 223 lines |
| 14 | [`docs/blog/articles/flutter/auth-notifier-token-storage-auth-state-machine.md`](docs/blog/articles/flutter/auth-notifier-token-storage-auth-state-machine.md) | 426 lines |
| 15 | [`docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md`](docs/blog/articles/flutter/global-upload-service-s3-compression-mime.md) | 1,379 lines |
| 16 | [`docs/blog/articles/flutter/gorouter-route-system-shell-route-auth.md`](docs/blog/articles/flutter/gorouter-route-system-shell-route-auth.md) | 554 lines |
| 17 | [`docs/blog/articles/flutter/http-static-class-dual-dio-native-adapter.md`](docs/blog/articles/flutter/http-static-class-dual-dio-native-adapter.md) | 483 lines |
| 18 | [`docs/blog/articles/flutter/hydrated-state-notifier-abstract-persistence.md`](docs/blog/articles/flutter/hydrated-state-notifier-abstract-persistence.md) | 415 lines |
| 19 | [`docs/blog/articles/flutter/image-cache-manager-l1-l2-responsive-image-service.md`](docs/blog/articles/flutter/image-cache-manager-l1-l2-responsive-image-service.md) | 1,244 lines |
| 20 | [`docs/blog/articles/flutter/kyc-guard-state-machine-route-guard.md`](docs/blog/articles/flutter/kyc-guard-state-machine-route-guard.md) | 235 lines |
| 21 | [`docs/blog/articles/flutter/lucky-form-theme-validator-system.md`](docs/blog/articles/flutter/lucky-form-theme-validator-system.md) | 1,748 lines |
| 22 | [`docs/blog/articles/flutter/reactive-forms-code-generation.md`](docs/blog/articles/flutter/reactive-forms-code-generation.md) | 2,012 lines |
| 23 | [`docs/blog/articles/flutter/share-service-deep-link-platform-integration.md`](docs/blog/articles/flutter/share-service-deep-link-platform-integration.md) | 347 lines |
| 24 | [`docs/blog/articles/flutter/unified-interceptor-error-strategy-token-refresh.md`](docs/blog/articles/flutter/unified-interceptor-error-strategy-token-refresh.md) | 310 lines |

## Execution Order

The batches are ordered by article count and complexity (smallest first):

1. **Batch 1**: `admin-next/` (3 articles, simplest format — no frontmatter, no date/tags metadata)
2. **Batch 2**: `api/` (8 articles — have Date/Tags/Code Reference headers, ToC sections)
3. **Batch 3**: `flutter/` (13 articles — largest batch, mixed formats, some very long)

## Quality Checklist (per article)

After translation, verify:
- [ ] All prose text is in Chinese
- [ ] Code blocks remain untouched (English/syntax intact)
- [ ] File paths and URLs are preserved
- [ ] Technical terms (NestJS, BullMQ, Redis, Dio, etc.) remain in English
- [ ] Mermaid/ASCII diagrams unchanged
- [ ] Links are functional (href preserved)
- [ ] Markdown formatting is valid (headings, tables, lists, code fences)
- [ ] No content was accidentally deleted or duplicated
- [ ] Frontmatter (if any) has title/tags in Chinese, slug preserved
