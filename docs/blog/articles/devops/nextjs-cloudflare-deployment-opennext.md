---
tags:
  - Cloudflare
  - DevOps
  - Next.js
  - CI/CD
  - OpenNext
  - Performance
---

# Next.js 博客的 Cloudflare 部署实战：OpenNext + ISR + GitLab CI/CD

## 1. 前言：为什么选择 Cloudflare？

### 1.1 面临的挑战

在博客上线初期，我们遇到了三个核心问题：

1. **页面转换体验差**：SSR 到 CSR 的切换导致明显的 loading 状态
2. **性能瓶颈**：所有请求都来自单一后端，没有边缘缓存
3. **全球访问延迟**：后端部署在单区域 VPS，海外用户加载缓慢

### 1.2 架构目标

```
🎯 性能目标：
  - LCP < 1 秒
  - 缓存命中率 > 80%
  - 服务器负载降低 > 80%
  - 全球一致的高速访问
```

选择 Cloudflare 的原因：

| 方案 | 边缘节点 | ISR 支持 | 成本 | 复杂度 |
|------|----------|----------|------|--------|
| Vercel | ✅ 全球 | ✅ 原生 | 💰 贵 | 低 |
| Cloudflare Pages | ✅ 300+ 节点 | ✅ OpenNext | 💵 便宜 | 中等 |
| 自建 CDN | ❌ 有限 | ❌ 需要自建 | 💸 运维成本高 | 高 |

**决策**：Cloudflare Pages + OpenNext，利用 300+ 边缘节点和 OpenNext 的 ISR 能力。

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    GitLab CI/CD Pipeline                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Build     │───▶│   Test      │───▶│   Deploy    │     │
│  │  Next.js    │    │  Lighthouse │    │  Cloudflare │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Cloudflare Global Network                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Edge ISR  │    │   Cache     │    │   Workers   │     │
│  │  (60s TTL)  │    │  (API/30s)  │    │  (Routing)  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend API (VPS)                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   NestJS    │    │   Prisma    │    │   Redis     │     │
│  │   API       │    │   Database  │    │   Cache     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 组件关系

| 组件 | 技术 | 位置 | 职责 |
|------|------|------|------|
| 前端博客 | Next.js | Cloudflare Pages | 页面渲染 |
| 边缘缓存 | Cloudflare Workers | 全球 300+ 节点 | ISR + API 缓存 |
| 后端 API | NestJS | VPS | 数据持久化 |
| CDN | Cloudflare Images | Cloudflare | 图片优化 |
| 监控 | Cloudflare Analytics + Telegram | — | 部署通知 |

### 2.3 数据流

```
User Request → Cloudflare Edge → Check Cache → Serve Cached Content
      ↓                              ↓
      └── Cache Miss ────────────────┘
                              ↓
                    Execute ISR or Fetch API
                              ↓
                    Update Cache + Return Response
```

---

## 3. Cloudflare 配置

### 3.1 wrangler.toml

```toml
name = "lucky-blog-prod"
main = ".open-next/worker.js"
compatibility_date = "2026-03-20"
compatibility_flags = ["nodejs_compat"]
minify = true

[[routes]]
pattern = "blog.joyminis.com/*"
zone_name = "joyminis.com"

[[routes]]
pattern = "blog-dev.joyminis.com/*"
zone_name = "joyminis.com"

[assets]
binding = "ASSETS"
directory = ".open-next/assets"

[vars]
AUTH_COOKIE_DOMAIN = ".joyminis.com"
NEXT_PUBLIC_BLOG_ENV = "production"
NEXT_PUBLIC_ENABLE_ISR = "true"
ISR_REVALIDATE_SECONDS = "60"
```

关键配置说明：

- **`main = ".open-next/worker.js"`**：OpenNext 构建输出的 Worker 入口
- **`nodejs_compat`**：启用 Node.js 兼容模式，支持 `crypto`、`path` 等模块
- **`routes`**：同时绑定生产域名和预览域名

### 3.2 页面级 ISR 策略

```typescript
// 文章页面：60 秒重新验证
export const revalidate = 60;

// 分类/标签页面：300 秒重新验证
export const revalidate = 300;

// 静态页面：无需验证（完全静态）
export const revalidate = false;
```

不同页面类型的 TTL 设计：

| 页面类型 | TTL | 原因 |
|----------|-----|------|
| 文章详情 | 60s | 编辑发布后快速生效 |
| 文章列表 | 120s | 平衡实时性和缓存效率 |
| 分类/标签 | 300s | 变更频率低 |
| 静态页面 | ∞ | 完全静态，不变更 |

### 3.3 API 响应缓存

```typescript
// Cloudflare Worker 缓存规则
const cacheRules = {
  "GET /api/articles/*": {
    edgeTTL: 30,    // 30 秒边缘缓存
    browserTTL: 0,  // 浏览器不缓存
  },
  "GET /api/categories": {
    edgeTTL: 300,   // 5 分钟边缘缓存
    browserTTL: 0,
  },
};
```

---

## 4. 性能优化

### 4.1 图片优化

```typescript
// 通过 Cloudflare Images 优化
const imageConfig = {
  format: "webp",       // 下一代图片格式
  quality: 80,          // 平衡质量与体积
  width: 1200,          // 桌面端最大宽度
  lazyLoading: true,    // 懒加载
  placeholder: "blur",  // 模糊占位
};
```

### 4.2 字体预加载

```html
<!-- 预加载关键字体 -->
<link
  rel="preload"
  href="/fonts/inter-var.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
```

### 4.3 关键 CSS 内联

使用 `@emotion/server` 提取首屏关键 CSS 并内联到 HTML 中，减少首屏渲染阻塞。

---

## 5. GitLab CI/CD 流水线

### 5.1 CI 变量

```bash
# 需要在 GitLab CI 设置中配置
CLOUDFLARE_API_TOKEN       # Cloudflare API 令牌
CLOUDFLARE_ACCOUNT_ID      # Cloudflare 账户 ID
NEXT_PUBLIC_API_BASE_URL   # 后端 API 地址
NEXT_PUBLIC_IMG_BASE_URL   # 图片 CDN 地址
TELEGRAM_TOKEN             # Telegram Bot Token
TELEGRAM_CHAT_ID           # 通知目标 Chat ID
```

### 5.2 部署流水线 (.gitlab/deploy-blog.yml)

```yaml
deploy-blog:
  stage: deploy
  image: node:20-bookworm
  tags:
    - saas-linux-large-amd64

  rules:
    - if: $CI_COMMIT_BRANCH == "main" || $CI_COMMIT_BRANCH == "test"
      changes:
        - apps/frontend-blog/**/*
        - packages/shared/**/*
        - packages/ui/**/*

  script:
    # 1. 环境准备
    - corepack enable
    - corepack prepare yarn@4.9.2 --activate
    - yarn install --immutable

    # 2. 构建共享包
    - node packages/shared/scripts/build.js
    - node packages/ui/scripts/build.js

    # 3. 构建 Next.js（使用 OpenNext）
    - cd apps/frontend-blog
    - NODE_ENV=production \
      NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
      NEXT_PUBLIC_IMG_BASE_URL=$NEXT_PUBLIC_IMG_BASE_URL \
      NEXT_PUBLIC_APP_ENV=$([ "$CI_COMMIT_BRANCH" = "main" ] && echo "production" || echo "preview") \
      yarn exec opennextjs-cloudflare build

    # 4. 验证 Cloudflare 凭证
    - |
      HTTP_STATUS=$(curl -s -o /tmp/cf-verify.json -w "%{http_code}" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/user/tokens/verify")
      # ... 验证逻辑

    # 5. 部署到 Cloudflare
    - CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN \
      CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID \
      yarn exec opennextjs-cloudflare deploy -c wrangler.toml

  after_script:
    # 6. Telegram 通知
    - |
      curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
        -d "chat_id=$TELEGRAM_CHAT_ID" \
        -d "text=$MESSAGE" \
        -d "parse_mode=Markdown"
```

### 5.3 流水线步骤详解

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | `corepack enable` | 启用 Yarn 4 PnP |
| 2 | `yarn install --immutable` | 安装依赖（使用缓存加速） |
| 3 | 构建共享包 | 先构建 `@lucky/shared` 和 `@repo/ui` |
| 4 | `opennextjs-cloudflare build` | 使用 OpenNext 构建，生成 Worker |
| 5 | 凭证验证 | 调用 Cloudflare API 验证 Token 有效性 |
| 6 | `opennextjs-cloudflare deploy` | 部署到 Cloudflare Pages |
| 7 | Telegram 通知 | 发送部署结果到团队群 |

---

## 6. 监控与运维

### 6.1 性能指标

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| LCP | < 1s | Cloudflare Analytics |
| 缓存命中率 | > 80% | Worker Logs + Cache Analytics |
| 服务器负载 | 降低 > 80% | 后端 API 请求数对比 |

### 6.2 日常运维清单

**每日检查**：
- Cloudflare Analytics 仪表板（流量、缓存命中率）
- Worker Logs（错误率监控）
- 后端 API 响应时间

**每周任务**：
- 审核缓存命中率报告
- 检查 Lighthouse 性能评分
- 更新优化策略

**每月任务**：
- 性能基准测试
- Cache 策略审计
- 成本分析

### 6.3 故障恢复

```bash
# 强制清除 Cloudflare 缓存
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything":true}'

# 回滚到上一版本（GitLab CI）
# 在 GitLab 中重新运行上一次成功的 Pipeline
```

---

## 7. 优化效果

### 7.1 预期收益

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| LCP | ~3s | < 1s |
| API 缓存命中率 | 0% | > 80% |
| 服务器请求数 | 100% | < 20% |
| 全球访问延迟 | 区域差异大 | 全球一致 |

### 7.2 实际验证

```bash
# 验证边缘缓存
curl -I https://blog.joyminis.com/articles/hello-world
# CF-Cache-Status: HIT  ← 说明从边缘缓存命中

# 验证 ISR
curl -I https://blog.joyminis.com/articles/hello-world
# CF-Cache-Status: MISS
# 第二次请求：
curl -I https://blog.joyminis.com/articles/hello-world
# CF-Cache-Status: HIT  ← ISR 已生成并缓存
```

---

## 8. 总结

这套 Cloudflare 部署架构的核心价值在于：

1. **OpenNext 桥接**：让 Next.js 的 ISR、SSR、SSG 完整运行在 Cloudflare Workers 边缘
2. **三层缓存**：Edge ISR（页面级） + CDN Cache（API 级） + 浏览器缓存
3. **GitLab CI/CD 自动化**：从代码提交到 Cloudflare 部署的全自动流水线
4. **Telegram 通知**：每次部署结果实时推送到团队

性能目标：**LCP < 1s，缓存命中率 > 80%，服务器负载降低 80%+**。

---

*相关文档：*
- [三层缓存架构实战](../performance/blog-caching-architecture-practice.md)
- [Yarn PnP Monorepo CI/CD 缓存策略](../performance/yarn-pnp-monorepo-ci-caching.md)
- [Cloudflare 边缘缓存配置](../../cloudflare-edge-cache-config.md)
- [缓存架构与验证指南](../../caching/BLOG_CACHING_ARCHITECTURE.md)
