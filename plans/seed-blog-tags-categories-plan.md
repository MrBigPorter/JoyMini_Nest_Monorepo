# Plan: Seed Blog Tags and Categories (Online-Safe)

## Problem

No blog categories/tags exist online. The existing [`seed-blog.ts`](apps/api/scripts/seed/seed-blog.ts) has categories and tags, but is **dangerous for production** because it does `deleteMany()` on all blog tables before inserting — wiping out any existing articles, comments, etc.

## Solution

Create [`seed-blog-categories-tags.ts`](apps/api/scripts/seed/seed-blog-categories-tags.ts) — a safe, idempotent script that:

- **Only inserts** categories and tags (no delete, no articles, no comments)
- **Idempotent**: checks slug uniqueness, skips if record already exists
- **Chinese-only names** (`zh`) — auto-translation handles multi-language
- **Standalone only**: NOT integrated into main seed orchestrator
- **Safe for production**: can be run any number of times without data loss

## Categories (6, from `docs/blog/articles/` directory structure)

| Name | Slug | Description |
|------|------|-------------|
| 系统架构 | architecture | NestJS, Prisma, three-tier tsconfig, IM, WebSocket |
| 后端开发 | backend | 订单支付, 钱包系统, WebRTC, 财务审计, Gemini AI |
| 运维与部署 | devops | Docker, Cloudflare, GitLab CI, Lighthouse CI, Sentry |
| 前端开发 | frontend | Next.js, React, SSR, PWA, 登录系统, i18n, SEO |
| 性能优化 | performance | 缓存架构, 打包体积优化, SSR UX, CI 缓存策略 |
| 安全防护 | security | JWT, reCAPTCHA, AI 审核, 设备指纹, 敏感词过滤 |

## Tags (27, from article frontmatter across 46 articles)

**Backend**: NestJS, Prisma, PostgreSQL, Redis, BullMQ, TypeScript
**Frontend**: Next.js, React, Tailwind CSS, SSR, PWA, SEO, i18n
**DevOps**: Docker, Cloudflare, CI/CD, Monorepo
**Architecture**: 架构设计, WebSocket, IM, 实时通信
**Security**: 安全, JWT, 认证授权, RBAC, AI
**Performance**: 性能优化

## Safety Design

```
for each category/tag:
  existing = findUnique by slug
  if existing → skip (idempotent)
  if not → create
```

No `deleteMany`, no `upsert`, no article/comment/data modification.

## Files

| File | Action |
|------|--------|
| `apps/api/scripts/seed/seed-blog-categories-tags.ts` | Created — safe idempotent seed |
| `apps/api/package.json` | Modified — `seed:blog` points to new script |
| `apps/api/scripts/seed/index.ts` | Unchanged — blog seed is standalone only |

## Usage

```bash
cd apps/api && yarn seed:blog
```
