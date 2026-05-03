---
tags:
  - OpenNext
  - Cloudflare
  - Next.js
  - Build
  - CI/CD
  - Sentry
  - i18n
  - Debug
---

# OpenNext Cloudflare 构建管道深度分析：从 Next.js 构建到 Worker 部署

> 基于 JoyMini Blog 项目的真实构建日志分析，深入剖析 OpenNext + Cloudflare Workers 的构建管道各阶段，以及两个非阻塞但值得注意的问题：Sentry 发布失败和 i18n 翻译缺失。

---

## 目录

1. [构建管道总览](#1-构建管道总览)
2. [Phase 1：Next.js 构建](#2-phase-1nextjs-构建)
3. [Phase 2：Sentry 发布（非致命失败）](#3-phase-2sentry-发布非致命失败)
4. [Phase 3：Manifest 复制](#4-phase-3manifest-复制)
5. [构建输出结构](#5-构建输出结构)
6. [问题 1：Sentry 环境变量缺失](#6-问题-1sentry-环境变量缺失)
7. [问题 2：i18n 翻译缺失](#7-问题-2i18n-翻译缺失)
8. [总结与建议](#8-总结与建议)

---

## 1. 构建管道总览

OpenNext 是 Next.js 的适配层，将 Next.js 的标准构建输出转换为 Cloudflare Workers 可运行的格式。整个构建管道分为 **4 个阶段**：

```
┌─────────────────────────────────────────────────────┐
│ 1. OpenNext Init                                     │
│    Monorepo detected → apps/frontend-blog             │
│    Next.js 15.2.4 / opennextjs-cloudflare 1.17.1      │
├─────────────────────────────────────────────────────┤
│ 2. Next.js Build (optimized production build) ✅      │
│    PWA server+client compile ✓  Service Worker gen ✓  │
├─────────────────────────────────────────────────────┤
│ 3. Sentry Release Creation ⚠️ FAILED (non-fatal)      │
│    sentry-cli: Project not found                       │
├─────────────────────────────────────────────────────┤
│ 4. Manifest Copy Script ✅                             │
│    30 manifest files copied to ASSETS                  │
└─────────────────────────────────────────────────────┘
```

**关键版本信息**：

| 组件 | 版本 |
|------|------|
| Next.js | 15.2.4 |
| `@opennextjs/cloudflare` | 1.17.1 |
| 应用 | `apps/frontend-blog` |
| 构建提交 | `1ad7a04657b71e4c77136fc7ede96624032ae894` |

---

## 2. Phase 1：Next.js 构建

### 2.1 构建状态

| 组件 | 状态 | 详情 |
|------|------|------|
| Production Build | ✅ | 优化 + 压缩 |
| PWA Server | ✅ | 编译成功 |
| PWA Client | ✅ | 静态 bundle 编译 |
| Service Worker | ✅ | `/sw.js`，scope `/` |
| Offline Fallback | ✅ | `/offline.html` |

### 2.2 生成的路由

从构建 manifest 中提取的路由清单：

| 路由 | 类型 | 说明 |
|------|------|------|
| `/` | SSG/ISR | 首页 |
| `/[locale]/` | SSG/ISR | 本地化首页 |
| `/[locale]/articles/[slug]` | SSR/ISR | 文章详情 |
| `/[locale]/tags` | SSG | 标签列表 |
| `/[locale]/tags/[slug]` | SSG/ISR | 标签详情 |
| `/[locale]/categories` | SSG | 分类列表 |
| `/[locale]/categories/[slug]` | SSG/ISR | 分类详情 |
| `/[locale]/about` | SSG | 关于页面 |
| `/[locale]/bookmarks` | SSR | 书签 |
| `/[locale]/search` | SSR | 搜索 |
| `/[locale]/login` | SSR | 登录 |
| `/[locale]/sitemap.xml` | SSG | 站点地图 |
| `/sitemap.xml` | SSG | 根站点地图 |
| `/robots.txt` | SSG | Robots |
| `/oauth/callback` | SSR | OAuth 回调 |
| `/_not-found` | SSG | 自定义 404 |

### 2.3 路由类型分布

```
SSG/ISR:  ████████████████████ 10 (62.5%)
SSR:      ████████              5 (31.3%)
SSG:      █                     1 (6.2%)
```

大部分页面使用 SSG/ISR，这意味着它们在构建时或首次访问后生成静态 HTML，后续请求由 Cloudflare 边缘缓存直接响应，无需每次都执行 SSR。

---

## 3. Phase 2：Sentry 发布（非致命失败）

### 3.1 错误信息

```
sentry-cli releases new 1ad7a04657b71e4c77136fc7ede96624032ae894
error: Project not found. Ensure that you configured the correct project and organization.
```

### 3.2 根因

在 CI 环境中，[`SENTRY_ORG`](.github/workflows/deploy-blog-cloudflare.yml:196) 环境变量未设置：

```yaml
# .github/workflows/deploy-blog-cloudflare.yml
env:
  SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
  # ❌ SENTRY_ORG is NOT set here
```

而 [`next.config.ts`](apps/frontend-blog/next.config.ts:427) 中 Sentry 插件需要它：

```typescript
withSentryConfig(wrappedConfig, {
  org: process.env.SENTRY_ORG,    // ← undefined in CI!
  project: 'tarsier-labs',
  // ...
})
```

由于 `SENTRY_ORG` 为 `undefined`，Sentry CLI 无法确定哪个组织包含 `tarsier-labs` 项目，导致发布创建失败。

### 3.3 影响分析

| 领域 | 状态 | 详情 |
|------|------|------|
| Source Map 上传 | ❌ 失败 | 未创建 release，Sentry 中无 source maps |
| 运行时错误追踪 | ⚠️ 未知 | `NEXT_PUBLIC_SENTRY_DSN` 未在 CI env 中 → 部署后可能未初始化 |
| 构建 | ✅ 继续 | 错误是非致命的，构建继续 |
| 可部署性 | ✅ 可部署 | 但监控能力降级 |

### 3.4 修复方案

在 CI workflow 的 `env` 中添加缺失的 Sentry 环境变量：

```yaml
env:
  SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
  SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
  NEXT_PUBLIC_SENTRY_DSN: ${{ secrets.NEXT_PUBLIC_BLOG_FRONENT_JOYMINIS_DSN }}
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: ${{ github.ref_name == 'main' && '0.02' || '0.1' }}
  NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: ${{ github.ref_name == 'main' && '0.005' || '0.02' }}
```

---

## 4. Phase 3：Manifest 复制

### 4.1 复制映射

构建完成后，一个自定义脚本将 30 个 manifest 文件从 Next.js 构建输出复制到 ASSETS 目录：

```
.open-next/server-functions/default/apps/frontend-blog/.next/
  └── *manifest*.json           → .open-next/assets/_next/
  └── server/app/**/client-ref* → .open-next/assets/_next/server/app/
  └── server/*manifest*         → .open-next/assets/_next/server/
```

### 4.2 文件分类

| 类别 | 数量 | 用途 |
|------|------|------|
| 根 manifest JSON | 6 | App build、route、build manifests |
| Client Reference JS | 14 | 每路由客户端组件水合 |
| 其他 manifests | 10 | 字体、middleware、server references |

这些文件是 Cloudflare Worker 正确渲染页面所必需的——它们告诉 Worker 哪些客户端组件需要水合、哪些路由可用、以及如何加载静态资源。

---

## 5. 构建输出结构

最终构建输出位于 `.open-next/` 目录：

```
.open-next/
├── assets/                         ← Cloudflare ASSETS 提供这些文件
│   ├── _next/static/               ← JS/CSS chunks (31536000s 缓存)
│   └── (manifest files)            ← 由 copy-manifests.sh 复制
└── server-functions/
    └── default/
        └── apps/frontend-blog/
            ├── .next/              ← 完整 Next.js 构建输出
            ├── worker.js           ← Cloudflare Worker 入口
            └── (patched by patch-worker-queue.mjs)
```

**关键文件**：

| 文件/目录 | 说明 |
|-----------|------|
| `assets/_next/static/` | 静态 JS/CSS 资源，缓存 1 年 |
| `server-functions/default/worker.js` | Cloudflare Worker 入口点 |
| `server-functions/default/.next/` | 完整的 Next.js 服务端代码 |

---

## 6. 问题 1：Sentry 环境变量缺失

### 6.1 完整的环境变量审计

| 环境变量 | 使用位置 | CI 状态 | 影响 |
|---------|---------|---------|------|
| `SENTRY_ORG` | `next.config.ts:427` — Sentry 插件 org | ❌ **缺失** | Release 创建失败 |
| `SENTRY_AUTH_TOKEN` | `next.config.ts:431` — Source map 上传认证 | ✅ 存在 | — |
| `NEXT_PUBLIC_SENTRY_DSN` | `instrumentation.ts:23` — 运行时 DSN | ❌ **缺失** | 运行时可能未初始化 |
| `NEXT_PUBLIC_SENTRY_DEBUG` | `instrumentation.ts:34` | ✅ `false` | — |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `instrumentation-client.ts:33` | ❌ **缺失** | 回退到 0（无追踪） |
| `NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE` | `instrumentation-client.ts:38` | ❌ **缺失** | 回退到 0（无性能分析） |

### 6.2 为什么 admin CI 没问题

有趣的是，[admin-next 的 workflow](.github/workflows/deploy-admin-cloudflare.yml:166-170) 已经正确设置了这些变量：

```yaml
# admin-next CI — 正确
NEXT_PUBLIC_SENTRY_DSN: ${{ secrets.NEXT_PUBLIC_SENTRY_DSN }}
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: ${{ github.ref_name == 'main' && '0.02' || '0.1' }}
NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: ${{ github.ref_name == 'main' && '0.005' || '0.02' }}
```

而 [blog 的 workflow](.github/workflows/deploy-blog-cloudflare.yml:196-199) 缺少了这些。这是两个 workflow 分别维护导致的配置漂移——正是我们在 [CI/CD 可复用工作流模式](docs/blog/articles/devops/ci-cd-reusable-workflow-patterns.md) 中讨论的问题。

### 6.3 修复步骤

1. 在 GitHub Secrets 中添加 `SENTRY_ORG`（值：`tarsier-labs`）
2. 在 blog workflow 的 `env` 中添加缺失的 4 个变量
3. 重新部署验证 Sentry release 创建成功

---

## 7. 问题 2：i18n 翻译缺失

### 7.1 运行时错误

从运行时调试日志中发现：

```
Error: MISSING_MESSAGE: about.founderTitle (de)
Error: MISSING_MESSAGE: about.founderDescription (de)
```

### 7.2 缺失矩阵

| Key | `en.json` | `zh.json` | `ja.json` | `ko.json` | `fr.json` | `de.json` |
|-----|:---------:|:---------:|:---------:|:---------:|:---------:|:---------:|
| `about.founderTitle` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `about.founderDescription` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `about.founderBio` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

3 种语言（ko、fr、de）缺少 `about.founderTitle` 和 `about.founderDescription`，共需添加 **6 条翻译**。

### 7.3 根因分析

这是典型的 **i18n 维护遗漏**——当新增页面内容时，只更新了部分语言文件。在 `next-intl` 中，缺失的消息会抛出运行时错误（而非静默回退），这有助于及早发现问题。

### 7.4 修复

在以下文件中添加缺失的翻译：

- [`apps/frontend-blog/src/messages/ko.json`](apps/frontend-blog/src/messages/ko.json)
- [`apps/frontend-blog/src/messages/fr.json`](apps/frontend-blog/src/messages/fr.json)
- [`apps/frontend-blog/src/messages/de.json`](apps/frontend-blog/src/messages/de.json)

```json
{
  "about": {
    "founderTitle": "创始人",
    "founderDescription": "关于创始人的描述"
  }
}
```

---

## 8. 总结与建议

### 8.1 构建状态总览

| 问题 | 类型 | 严重性 | 修复状态 |
|------|------|--------|---------|
| Sentry Release 失败 | 构建警告 | ⚠️ 低 | 需添加 `SENTRY_ORG` + `NEXT_PUBLIC_SENTRY_DSN` 到 CI secrets |
| 缺少 `founderTitle`/`founderDescription` | 运行时错误 | 🐛 中 | 需添加 2 keys × 3 locales = 6 条翻译 |

**总体评估**：构建成功，可部署。两个非阻塞问题已识别。

### 8.2 关键教训

1. **CI 环境变量配置漂移是常见问题**：admin 和 blog 的 workflow 分别维护，导致 blog 缺少 Sentry 变量。使用 reusable workflow 可以避免此类问题。

2. **i18n 翻译缺失是渐进式问题**：新增页面内容时容易遗漏部分语言。建议：
   - 在 CI 中添加 i18n 完整性检查
   - 使用自动化翻译工具（如本项目的 AI 翻译引擎）确保所有语言同步更新

3. **OpenNext 构建管道是透明的**：虽然 OpenNext 做了大量适配工作（打包、manifest 复制、Worker 入口生成），但构建日志清晰地展示了每个阶段的状态，便于排查问题。

### 8.3 与现有文档的关系

本文是 OpenNext 构建管道的深度分析，与以下文档互补：

- [`ssg-ssr-isr-cloudflare-complete-guide.md`](docs/blog/articles/devops/ssg-ssr-isr-cloudflare-complete-guide.md) — Cloudflare Workers 配置全面指南
- [`cloudflare-workers-cpu-limit-deep-dive.md`](docs/blog/articles/devops/cloudflare-workers-cpu-limit-deep-dive.md) — Workers CPU 性能优化
- [`ci-cd-reusable-workflow-patterns.md`](docs/blog/articles/devops/ci-cd-reusable-workflow-patterns.md) — CI/CD 可复用工作流模式

---

> **相关文件**：[`opennext-build-analysis.md`](plans/opennext-build-analysis.md) — 原始构建分析文档
