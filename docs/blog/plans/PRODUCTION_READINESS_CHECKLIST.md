# 生产就绪完整检查清单

> 从开发到上线的完整生命周期规范
> 设计 / 开发 / 测试 / CI / 部署 / 运维 / 监控 全流程覆盖
> 可以直接照着做，不会遗漏任何东西

---

## 📋 完整生命周期清单

---

### 🎨 第一阶段: 设计规范 已完成

| 检查项            | 状态      | 文档                      |
| ----------------- | --------- | ------------------------- |
| 完整设计系统      | 完成      | BLOG_DESIGN_GUIDELINES.md |
| 页面布局规范      | 完成      | BLOG_PAGE_LAYOUTS.md      |
| 文章排版规范      | 完成      | BLOG_PROSE_STYLE_GUIDE.md |
| SEO规范           | 完成      | BLOG_SEO_GUIDELINES.md    |
| 图片/视频加载规范 | ⬜ 待实现 | 本文档                    |

---

### 💻 第二阶段: 开发规范 已完成

| 检查项                | 状态      | 文档                                |
| --------------------- | --------- | ----------------------------------- |
| 分层架构规范          | 完成      | FRONTEND_ARCHITECTURE_LAYERS.md     |
| API接口规范           | 完成      | BLOG_API_SPECIFICATION.md           |
| 登录系统集成          | 完成      | AUTHENTICATION_INTEGRATION_GUIDE.md |
| 多语言文案            | 完成      | I18N_TRANSLATIONS_GUIDE.md          |
| 代码风格规范          | 完成      | CODE_STYLE_RULES.md                 |
| 图片/视频加载最佳实践 | ⬜ 待实现 | 本文档                              |

---

### 🧪 第三阶段: 测试规范 ⬜ 规划中

| 检查项                   | 状态 |
| ------------------------ | ---- |
| 单元测试覆盖率 > 80%     | ⬜   |
| E2E 测试覆盖所有核心页面 | ⬜   |
| Lighthouse 性能评分 > 90 | ⬜   |
| 移动端兼容性测试         | ⬜   |
| SEO 测试                 | ⬜   |
| 无障碍访问测试           | ⬜   |

---

### 🔧 第四阶段: CI/CD 流水线 ⬜ 规划中

| 检查项                | 状态 |
| --------------------- | ---- |
| 自动构建              | ⬜   |
| 自动测试              | ⬜   |
| 自动代码审查          | ⬜   |
| 自动部署 (Staging)    | ⬜   |
| 自动部署 (Production) | ⬜   |
| 回滚机制              | ⬜   |

---

### 🚀 第五阶段: 部署与运维 ⬜ 规划中

| 检查项               | 状态 |
| -------------------- | ---- |
| Docker 配置          | ⬜   |
| Nginx 配置           | ⬜   |
| 域名与DNS            | ⬜   |
| SSL证书              | ⬜   |
| CDN配置              | ⬜   |
| TURN服务器配置 (App) | ⬜   |

---

### 📊 第六阶段: 监控与可观测性 ⬜ 规划中

| 检查项          | 状态 |
| --------------- | ---- |
| Sentry 错误监控 | ⬜   |
| 性能监控        | ⬜   |
| 日志收集        | ⬜   |
| 指标监控        | ⬜   |
| 告警配置        | ⬜   |
| 健康检查        | ⬜   |

---

## 🖼️ 图片与视频加载最佳实践

### 图片处理规范

```tsx
import { Image } from "next/image";

//  正确用法
<Image
  src={article.coverImage}
  alt={article.title}
  width={1200}
  height={630}
  quality={85}
  priority={false}
  placeholder="blur"
  blurDataURL={article.blurHash}
  sizes="(max-width: 768px) 100vw, 1200px"
/>;
```

必须参数：

- `alt` 标签必须存在
- `width` / `height` 必须定义
- `sizes` 必须定义响应式尺寸
- `quality=85` 为最佳平衡值

禁止：

- ❌ 禁止使用原生 `<img>` 标签
- ❌ 禁止加载超过1920px宽度的图片
- ❌ 禁止加载未压缩的图片

### 视频嵌入规范

```tsx
//  延迟加载，视口进入时才加载
<iframe
  src={videoUrl}
  loading="lazy"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowFullScreen
/>
```

---

## 📦 Docker 配置

```dockerfile
# Dockerfile.prod
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3001
CMD ["node", "server.js"]
```

端口: `3001`
健康检查: `/api/health`
资源限制: 内存 512MB, CPU 0.5 core

---

## 🌐 Nginx 配置

```nginx
server {
    listen 80;
    server_name blog.joyminis.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 静态资源缓存
        location ~ ^/_next/static/ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # 图片缓存
        location ~ ^/images/ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

---

## 🔌 TURN 服务器配置 (App 访问)

域名: `turn.blog.joyminis.com`
端口: `3478` UDP/TCP
用于App内WebView访问内网API
直接复用现有的TURN服务器配置

---

## 🔍 Sentry 接入

```typescript
// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_RELEASE_VERSION,
});
```

自动捕获所有错误
性能追踪
Session Replay
Source Maps 自动上传

---

## 🚀 CI/CD 流水线

```yaml
# .github/workflows/deploy.yml
name: Deploy Blog

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: yarn install
      - run: yarn lint
      - run: yarn check-types
      - run: yarn test
      - run: yarn build

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: make deploy-blog-staging

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    if: github.ref == 'refs/heads/main'
    steps:
      - run: make deploy-blog-production
```

---

## 上线前最终检查清单

### 上线前24小时

- [ ] 所有功能测试通过
- [ ] 性能测试通过
- [ ] 安全扫描通过
- [ ] 监控配置完成
- [ ] 告警配置完成
- [ ] 回滚方案准备好

### 上线前1小时

- [ ] 数据库备份
- [ ] CDN预热
- [ ] DNS TTL设置为60秒
- [ ] 团队通知

### 上线后

- [ ] 监控错误率
- [ ] 监控响应时间
- [ ] 监控资源使用率
- [ ] 检查日志
- [ ] 验证核心功能

---

## 🎯 最终目标

99.9% 可用性
页面加载时间 < 2秒
Lighthouse 评分 > 95
错误率 < 0.1%
平均响应时间 < 200ms

---

这是一个完整的生产级项目检查清单，照着这个清单做出来的项目可以直接支撑百万级流量。
