# 分类

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/product-category-list.ts"

# 商品

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-treasures.ts"

# 关联（商品-分类）

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/link-treasure-categories.ts"

# 首页 banner

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-banners.ts"

# 首页广告

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-ads.ts"

# actSections

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-sections.ts"

# exchange rates

docker exec -it lucky-backend-dev \
sh -lc "cd apps/api && yarn dlx tsx scripts/seed/system-config-exchange-rate.ts"

# 钱包

docker exec -it lucky-backend-dev sh -lc "\
cd /app && \
yarn workspace @lucky/api dlx tsx scripts/seed/seed-wallet.ts"

# 博客种子数据

博客有 **两个** 种子脚本，用途不同，请勿混淆：

- **seed-blog-categories-tags.ts** (安全) — 仅插入分类和标签，幂等，不删除任何数据 ✅
- **seed-blog.ts** (危险) — 清空 + 重导入全量博客数据（含文章），**请勿在生产环境运行** ❌

---

## ✅ 安全脚本：分类 + 标签（推荐线上使用）

### 功能

- 插入 6 个分类 + 27 个标签
- **幂等**：按 slug 检测，已存在则跳过
- **不删除任何数据**：没有 `deleteMany`，不触及文章/评论
- 中文名称，后续由自动翻译补充多语言

### 数据内容

- **分类**: 系统架构、后端开发、运维与部署、前端开发、性能优化、安全防护
- **标签**: NestJS, Prisma, PostgreSQL, Redis, BullMQ, TypeScript, Next.js, React, Tailwind CSS, SSR, PWA, SEO, i18n, Docker, Cloudflare, CI/CD, Monorepo, 架构设计, WebSocket, IM, 实时通信, 安全, JWT, 认证授权, RBAC, AI, 性能优化

### 生产环境运行（Docker 容器内）

```bash
docker exec lucky-backend-prod node /app/apps/api/dist/cli/seed/seed-blog-categories-tags.js
```

### 本地开发环境运行

```bash
cd apps/api && yarn seed:blog
```

### 安全验证

| 安全措施 | 状态 |
|---------|------|
| `deleteMany` 调用 | ❌ 无 — 不删除任何数据 |
| 幂等性（slug 唯一性检测） | ✅ 已实现 — 存在则跳过 |
| 仅操作分类和标签表 | ✅ 不触及 articles/comments 等 |
| 无需修改已有数据 | ✅ upsert/createOrUpdate 都不用 |
| 可重复运行 | ✅ 重复运行无副作用 |

---

## ⚠️ 危险脚本：全量博客种子（仅限本地清空测试）

**请勿在生产环境运行！** 该脚本执行 `deleteMany()` 清空所有博客数据（文章、评论、分类、标签），然后重新导入 6 篇示例文章。

```bash
# 仅限本地开发数据库！
cd apps/api && npx tsx scripts/seed/seed-blog.ts
```
