# Blog 分类与标签重新整理计划

> 目标：重新设计分类和标签体系，覆盖全部 52 篇已有文章 + 64 篇计划文章
> 涉及修改文件：`apps/api/scripts/seed/seed-blog.ts`（更新 CATEGORIES + TAGS）

---

## 一、分类体系（6 → 8 类）

| 当前分类 | 状态 | 现有文章 | 计划文章 | 说明 |
|---------|------|---------|---------|------|
| `backend` | ✅ 保留 | 5 | +18 API 篇 | NestJS 后端系列 |
| `frontend` | ✅ 保留 | 18 | +3 frontend-blog 篇 + 16 admin-next 篇 | 前端技术 |
| `devops` | ✅ 保留 | 6 | 已在 frontend/performance 覆盖 | 运维与部署 |
| `architecture` | ✅ 保留 | 7 | 0 | 系统架构设计 |
| `security` | ✅ 保留 | 8 | 0 | 安全防护 |
| `projects` | ✅ 保留 | 4 | 0 | 项目介绍 |
| **`mobile`** | **🆕 新增** | 0 | +27 Flutter 篇 | Flutter 移动端开发 |
| **`performance`** | **🆕 新增** | 3 | 0 | 性能优化（从 frontend 分离） |

### 新增分类详情

```typescript
{
  name: { zh: '移动开发' },
  slug: 'mobile',
  description: { zh: 'Flutter, Dart, 跨平台开发, 移动端架构' },
},
{
  name: { zh: '性能优化' },
  slug: 'performance',
  description: { zh: '打包体积优化, SSR 渲染优化, CI/CD 缓存策略' },
},
```

---

## 二、标签体系（24 → 60+ 标签）

### 2.1 保留的现有标签（24 个）

| 当前标签 | Slug | 保留/修改 | 说明 |
|---------|------|----------|------|
| NestJS | `nestjs` | ✅ 保留 | |
| Prisma | `prisma` | ✅ 保留 | |
| PostgreSQL | `postgresql` | ✅ 保留 | |
| Redis | `redis` | ✅ 保留 | |
| BullMQ | `bullmq` | ✅ 保留 | |
| TypeScript | `typescript` | ✅ 保留 | |
| Next.js | `nextjs` | ✅ 保留 | |
| React | `react` | ✅ 保留 | |
| Tailwind CSS | `tailwind` | ✅ 保留 | |
| Shadcn UI | `shadcn-ui` | ✅ 保留 | |
| 服务端渲染 | `ssr` | ✅ 保留 | |
| Docker | `docker` | ✅ 保留 | |
| Cloudflare | `cloudflare` | ✅ 保留 | |
| Monorepo | `monorepo` | ✅ 保留 | |
| Turbo | `turbo` | ✅ 保留 | |
| XSS | `xss` | ✅ 保留 | |
| ReCaptcha | `recaptcha` | ✅ 保留 | |
| AhoCorasick | `aho-corasick` | ✅ 保留 | |
| AI Moderation | `ai-moderation` | ✅ 保留 | |
| Microservices | `microservices` | ✅ 保留 | |
| High Availability | `high-availability` | ✅ 保留 | |
| Message Queue | `message-queue` | ✅ 保留 | |
| LLM | `llm` | ✅ 保留 | |
| Prompt Engineering | `prompt-engineering` | ✅ 保留 | |

### 2.2 新增标签（按技术域分组）

#### Backend / API 域（+13）

| 标签 | Slug | 用于 | 来源 |
|-----|------|-----|------|
| WebSocket | `websocket` | IM, WebRTC, 评论实时推送 | 现有文章 + 计划 |
| Authentication | `authentication` | OAuth, JWT, Cookie | 现有文章 + 计划 |
| Authorization | `authorization` | RBAC, 权限系统 | 现有文章 + 计划 |
| API Design | `api-design` | DTO, 统一响应, 异常体系 | 计划 API P12 |
| Media Processing | `media-processing` | Sharp, HLS 转码 | 计划 API P3 |
| Upload | `upload` | S3/R2 预签名, 文件上传 | 计划 API P8 |
| Queue | `queue` | BullMQ 队列监控 | 现有 + 计划 API P9 |
| Distributed Lock | `distributed-lock` | Redis 分布式锁 | 计划 API P14 |
| Device Security | `device-security` | 设备指纹, 风控 | 现有 + 计划 API P10 |
| KYC | `kyc` | 身份验证 | 现有文章 |
| Payment | `payment` | Xendit, 支付流水 | 现有 + 计划 |
| E-commerce | `ecommerce` | 团购, 订单, 秒杀 | 现有 + 计划 |
| Chat / IM | `im` | 即时通讯, Socket | 现有 + 计划 |

#### Frontend 域（+16）

| 标签 | Slug | 用于 | 来源 |
|-----|------|-----|------|
| i18n | `i18n` | 多语言 | 现有 8+ 文章 |
| SEO | `seo` | Sitemap, JSON-LD, Crawler | 现有文章 |
| PWA | `pwa` | 离线访问 | 现有文章 |
| Animation | `animation` | Framer Motion, 页面过渡 | 现有文章 |
| Video / HLS | `hls` | 视频转码, 播放 | 现有文章 |
| React Query | `react-query` | 数据获取, 缓存 | 现有 + 计划 |
| Zustand | `zustand` | 状态管理 | 现有 + 计划 |
| React Hook Form | `react-hook-form` | 表单 | 现有 admin-blog 文章 |
| Zod | `zod` | 验证 | 现有 admin-blog 文章 |
| OAuth | `oauth` | 第三方登录 | 现有 + 计划 |
| Rich Text Editor | `rich-text-editor` | ReactQuill, Blot | 现有 admin-blog 文章 |
| CMS | `cms` | Blog CMS | 现有 admin-blog 文章 |
| AI Translation | `ai-translation` | Gemini 翻译 | 现有 + 计划 |
| SmartTable | `smart-table` | 泛型表格 | 计划 admin-next A1 |
| Middleware | `middleware` | JWT 路由守卫 | 现有 + 计划 |
| DataSynchronizer | `data-sync` | 深度比较, 序列化 | 计划 admin-next A7 |

#### DevOps 域（+5）

| 标签 | Slug | 用于 | 来源 |
|-----|------|-----|------|
| CI/CD | `cicd` | GitLab CI, GitHub Actions | 现有 + 计划 |
| Sentry | `sentry` | 错误监控, 可观测性 | 现有 + 计划 |
| Lighthouse | `lighthouse` | 性能审计 | 现有 + 计划 |
| Monitoring | `monitoring` | LN, Sentry | 现有 + 计划 |
| Prisma Migration | `prisma-migration` | v5→v6 迁移 | 现有文章 |

#### Mobile / Flutter 域（+15）

| 标签 | Slug | 用于 | 来源 |
|-----|------|-----|------|
| Flutter | `flutter` | Flutter 框架 | 现有 + 27篇计划 |
| Dart | `dart` | Dart 语言 | 计划 |
| Riverpod | `riverpod` | 状态管理 | 计划 |
| GoRouter | `gorouter` | 路由 | 计划 |
| Dio | `dio` | HTTP 客户端 | 计划 |
| Firebase | `firebase` | FCM, Auth | 计划 |
| WebRTC | `webrtc` | 通话, 信令 | 计划 |
| Deep Link | `deep-link` | OAuth, 分享 | 计划 |
| State Management | `state-management` | Riverpod, StateNotifier | 计划 |
| Design Tokens | `design-tokens` | 主题系统 | 计划 |
| Image Cache | `image-cache` | L1/L2 缓存 | 计划 |
| S3 Upload | `s3-upload` | Flutter 上传 | 计划 |
| Device Fingerprint | `device-fingerprint` | 移动端指纹 | 计划 |
| KYC Guard | `kyc-guard` | 路由守卫 | 计划 |
| Animations | `motion-x` | MotionX, WiggleOnTap | 计划 |

#### Security 域（+4）

| 标签 | Slug | 用于 | 来源 |
|-----|------|-----|------|
| Content Security | `content-security` | CSP, 安全头 | 现有文章 |
| Bot Detection | `bot-detection` | 反爬, 反机器人 | 现有文章 |
| Sensitive Word Filter | `sensitive-word` | AC 自动机 | 现有文章 |
| JWT | `jwt` | Token 认证 | 现有 + 计划 |

#### Architecture & Best Practices 域（+4）

| 标签 | Slug | 用于 | 来源 |
|-----|------|-----|------|
| Platform Adapter | `platform-adapter` | 三端统一架构 | 现有文章 |
| Real-time | `real-time` | WebSocket, IM | 现有文章 |
| Error Handling | `error-handling` | 异常体系 | 现有 + 计划 |
| Cache Strategy | `cache` | ISR, Redis, SWR | 现有 + 计划 |

---

## 三、修改范围

### 文件 1: `apps/api/scripts/seed/seed-blog.ts`

1. **CATEGORIES 数组**（lines 19-62）
   - 保留现有 6 个分类
   - 新增 `mobile`（移动开发）和 `performance`（性能优化）分类
   - 更新现有分类的 description 以覆盖更广

2. **TAGS 数组**（lines 67-132）
   - 保留现有 24 个标签
   - 新增 ~40 个标签（整理后约 60+ 总标签）
   - 按域分组：Backend, Frontend, DevOps, Security, Mobile, Architecture, Best Practices

3. **ARTICLES 数组**（lines 137-505）
   - 不修改现有文章种子数据
   - （可选）添加新的示例文章代表新分类

### 文件 2: `plans/full-writing-plan.md`（可选）

- 在每篇计划文章的描述中添加推荐标签
- 例如：`**推荐标签**: flutter, riverpod, app-bootstrap`

---

## 四、执行步骤

| # | 操作 | 文件 | 预期改动 |
|---|------|-----|---------|
| 1 | 新增 `mobile` 和 `performance` 分类 | `seed-blog.ts` CATEGORIES | +2 个分类对象 |
| 2 | 保留并更新现有 24 个标签的 color | `seed-blog.ts` TAGS | 保留，可能调整颜色 |
| 3 | 新增 40 个标签 | `seed-blog.ts` TAGS | ~40 个新对象 |
| 4 | 验证所有 slug 无重复 | `seed-blog.ts` | 检查 slug 唯一性 |
| 5 | 运行 seed 脚本验证 | CLI | `yarn workspace @lucky/api seed:blog` |
| 6 | 可选：更新 writing plan 添加标签 | `full-writing-plan.md` | 添加推荐标签 |

---

## 五、完整的新标签列表（按 Alphabetical 排序）

```typescript
const TAGS = [
  // === Backend ===
  { name: { zh: 'API Design' }, slug: 'api-design', color: '#0ea5e9' },
  { name: { zh: 'Authentication' }, slug: 'authentication', color: '#8b5cf6' },
  { name: { zh: 'Authorization / RBAC' }, slug: 'authorization', color: '#a855f7' },
  { name: { zh: 'BullMQ' }, slug: 'bullmq', color: '#7248d4' },
  { name: { zh: 'Chat / IM' }, slug: 'im', color: '#06b6d4' },
  { name: { zh: 'Device Security' }, slug: 'device-security', color: '#ef4444' },
  { name: { zh: 'Distributed Lock' }, slug: 'distributed-lock', color: '#f59e0b' },
  { name: { zh: 'E-commerce' }, slug: 'ecommerce', color: '#10b981' },
  { name: { zh: 'KYC' }, slug: 'kyc', color: '#6366f1' },
  { name: { zh: 'Media Processing' }, slug: 'media-processing', color: '#ec4899' },
  { name: { zh: 'Message Queue' }, slug: 'message-queue', color: '#0ea5e9' },
  { name: { zh: 'NestJS' }, slug: 'nestjs', color: '#e0234e' },
  { name: { zh: 'Payment' }, slug: 'payment', color: '#22c55e' },
  { name: { zh: 'PostgreSQL' }, slug: 'postgresql', color: '#336791' },
  { name: { zh: 'Prisma' }, slug: 'prisma', color: '#2D3748' },
  { name: { zh: 'Queue' }, slug: 'queue', color: '#8b5cf6' },
  { name: { zh: 'Redis' }, slug: 'redis', color: '#dc382d' },
  { name: { zh: 'Upload' }, slug: 'upload', color: '#14b8a6' },
  { name: { zh: 'WebSocket' }, slug: 'websocket', color: '#22c55e' },

  // === Frontend ===
  { name: { zh: 'AI Translation' }, slug: 'ai-translation', color: '#14b8a6' },
  { name: { zh: 'Animation' }, slug: 'animation', color: '#f472b6' },
  { name: { zh: 'CMS' }, slug: 'cms', color: '#f59e0b' },
  { name: { zh: 'DataSynchronizer' }, slug: 'data-sync', color: '#6366f1' },
  { name: { zh: 'i18n' }, slug: 'i18n', color: '#06b6d4' },
  { name: { zh: 'Middleware' }, slug: 'middleware', color: '#ef4444' },
  { name: { zh: 'Next.js' }, slug: 'nextjs', color: '#000000' },
  { name: { zh: 'OAuth' }, slug: 'oauth', color: '#4285f4' },
  { name: { zh: 'PWA' }, slug: 'pwa', color: '#8b5cf6' },
  { name: { zh: 'React' }, slug: 'react', color: '#61dafb' },
  { name: { zh: 'React Hook Form' }, slug: 'react-hook-form', color: '#ec4899' },
  { name: { zh: 'React Query' }, slug: 'react-query', color: '#ef4444' },
  { name: { zh: 'Rich Text Editor' }, slug: 'rich-text-editor', color: '#f59e0b' },
  { name: { zh: 'SEO' }, slug: 'seo', color: '#10b981' },
  { name: { zh: 'Shadcn UI' }, slug: 'shadcn-ui', color: '#000000' },
  { name: { zh: 'SmartTable' }, slug: 'smart-table', color: '#6366f1' },
  { name: { zh: 'SSR' }, slug: 'ssr', color: '#10b981' },
  { name: { zh: 'Tailwind CSS' }, slug: 'tailwind', color: '#06b6d4' },
  { name: { zh: 'TypeScript' }, slug: 'typescript', color: '#3178c6' },
  { name: { zh: 'Video / HLS' }, slug: 'hls', color: '#22c55e' },
  { name: { zh: 'Zod' }, slug: 'zod', color: '#1e3a5f' },
  { name: { zh: 'Zustand' }, slug: 'zustand', color: '#f59e0b' },

  // === DevOps ===
  { name: { zh: 'CI/CD' }, slug: 'cicd', color: '#f97316' },
  { name: { zh: 'Cloudflare' }, slug: 'cloudflare', color: '#f38020' },
  { name: { zh: 'Docker' }, slug: 'docker', color: '#2496ed' },
  { name: { zh: 'Lighthouse' }, slug: 'lighthouse', color: '#f59e0b' },
  { name: { zh: 'Monitoring' }, slug: 'monitoring', color: '#0ea5e9' },
  { name: { zh: 'Monorepo' }, slug: 'monorepo', color: '#f59e0b' },
  { name: { zh: 'Prisma Migration' }, slug: 'prisma-migration', color: '#2D3748' },
  { name: { zh: 'Sentry' }, slug: 'sentry', color: '#fb7185' },
  { name: { zh: 'Turbo' }, slug: 'turbo', color: '#ef4444' },

  // === Security ===
  { name: { zh: 'AI Moderation' }, slug: 'ai-moderation', color: '#14b8a6' },
  { name: { zh: 'AhoCorasick' }, slug: 'aho-corasick', color: '#8b5cf6' },
  { name: { zh: 'Bot Detection' }, slug: 'bot-detection', color: '#dc2626' },
  { name: { zh: 'Content Security' }, slug: 'content-security', color: '#6366f1' },
  { name: { zh: 'JWT' }, slug: 'jwt', color: '#000000' },
  { name: { zh: 'ReCaptcha' }, slug: 'recaptcha', color: '#4285f4' },
  { name: { zh: 'Sensitive Word Filter' }, slug: 'sensitive-word', color: '#8b5cf6' },
  { name: { zh: 'XSS' }, slug: 'xss', color: '#dc2626' },

  // === Mobile / Flutter ===
  { name: { zh: 'Animations' }, slug: 'motion-x', color: '#f472b6' },
  { name: { zh: 'Dart' }, slug: 'dart', color: '#0175C2' },
  { name: { zh: 'Deep Link' }, slug: 'deep-link', color: '#8b5cf6' },
  { name: { zh: 'Design Tokens' }, slug: 'design-tokens', color: '#f59e0b' },
  { name: { zh: 'Device Fingerprint' }, slug: 'device-fingerprint', color: '#ef4444' },
  { name: { zh: 'Dio' }, slug: 'dio', color: '#0ea5e9' },
  { name: { zh: 'Firebase' }, slug: 'firebase', color: '#FFCA28' },
  { name: { zh: 'Flutter' }, slug: 'flutter', color: '#02569B' },
  { name: { zh: 'GoRouter' }, slug: 'gorouter', color: '#22c55e' },
  { name: { zh: 'Image Cache' }, slug: 'image-cache', color: '#14b8a6' },
  { name: { zh: 'KYC Guard' }, slug: 'kyc-guard', color: '#6366f1' },
  { name: { zh: 'Riverpod' }, slug: 'riverpod', color: '#8b5cf6' },
  { name: { zh: 'S3 Upload' }, slug: 's3-upload', color: '#f97316' },
  { name: { zh: 'State Management' }, slug: 'state-management', color: '#a855f7' },
  { name: { zh: 'WebRTC' }, slug: 'webrtc', color: '#22c55e' },

  // === Architecture & Best Practices ===
  { name: { zh: 'Best Practices' }, slug: 'best-practices', color: '#22c55e' },
  { name: { zh: 'Cache Strategy' }, slug: 'cache', color: '#f59e0b' },
  { name: { zh: 'Error Handling' }, slug: 'error-handling', color: '#ef4444' },
  { name: { zh: 'High Availability' }, slug: 'high-availability', color: '#f97316' },
  { name: { zh: 'LLM' }, slug: 'llm', color: '#6366f1' },
  { name: { zh: 'Microservices' }, slug: 'microservices', color: '#22c55e' },
  { name: { zh: 'Performance' }, slug: 'performance', color: '#f59e0b' },
  { name: { zh: 'Platform Adapter' }, slug: 'platform-adapter', color: '#06b6d4' },
  { name: { zh: 'Prompt Engineering' }, slug: 'prompt-engineering', color: '#ec4899' },
  { name: { zh: 'Real-time' }, slug: 'real-time', color: '#0ea5e9' },
];
```
