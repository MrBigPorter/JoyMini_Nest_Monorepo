# Lucky Blog - 现代化博客平台

一个高性能、多平台的博客应用，基于 Next.js 15 构建，采用双架构优化策略，同时支持 Web 和原生应用体验。

## 📋 目录

- [🚀 快速开始](#-快速开始)
- [📱 Capacitor移动开发](#-capacitor移动开发)
- [🌐 Cloudflare Tunnel配置](#-cloudflare-tunnel配置)
- [🏗️ 架构设计](#️-架构设计)
- [🛠️ 技术栈](#️-技术栈)
- [📦 项目结构](#-项目结构)
- [🌐 部署指南](#-部署指南)
- [🎯 性能优化](#-性能优化)
- [🧪 测试策略](#-测试策略)
- [📊 监控与分析](#-监控与分析)
- [🔧 开发指南](#-开发指南)
- [🤝 贡献指南](#-贡献指南)
- [📄 许可证](#-许可证)

## 🚀 快速开始

### 环境要求

- Node.js 20+
- Yarn 4+
- Git
- iOS开发：Xcode 15+（macOS）
- Android开发：Android Studio（可选）

### 安装步骤

1. **克隆仓库**

```bash
git clone https://gitlab.com/MrSuperPorter/joy_mini_monorepo.git
cd lucky_nest_monorepo
```

2. **安装依赖**

```bash
yarn install
```

3. **配置环境变量**

```bash
cd apps/frontend-blog
cp .env.development .env.local
# 编辑 .env.local 配置您的环境
```

4. **启动开发服务器**

```bash
yarn dev
```

应用将在 `http://localhost:4002` 可用

### 构建与测试

```bash
# 构建生产版本
yarn build

# 启动生产服务器
yarn start

# 运行测试
yarn test

# 运行类型检查
yarn type-check

# 代码格式化
yarn format
```

## 📱 Capacitor移动开发

### 🎯 一句话指南
**打一个命令，改代码，手机自动刷新**

### 📋 核心命令

#### 第一次使用（完整配置）
```bash
# 一键搞定所有配置
yarn dev:full
```

#### 日常开发（iOS）
```bash
# 启动开发环境 + 手机热更新
yarn dev:ios
```

#### 其他常用命令
```bash
# 只构建不运行
yarn build:ios

# 重新加载（修改原生代码后）
yarn reload:ios

# 热重载（修改Web代码后自动刷新）
yarn hotreload:ios

# 修复Xcode问题
yarn setup:ios

# 同步Capacitor配置
yarn ios:sync
```

### ⚡ 开发工作流

#### 1. 启动开发
```bash
yarn dev:ios
```

#### 2. 选择设备
- 选择你的iPhone或模拟器
- 第一次需要信任开发者（手机设置 → 通用 → VPN与设备管理）

#### 3. 开始开发
- 修改 `src/` 目录下的任何文件
- 保存文件
- 手机自动刷新

### 🔧 Capacitor配置

#### 配置文件：`capacitor.config.ts`
```typescript
// 开发环境检测
const isDev = process.env.NODE_ENV === 'development';

const config: CapacitorConfig = {
  appId: 'com.tarsier.labs',
  appName: isDev ? 'Tarsier Labs Dev' : 'Tarsier Labs',
  webDir: 'out',
  server: isDev
    ? {
        // 开发环境：连接到Cloudflare Tunnel公网域名
        url: 'https://dev.joyminis.com',
        cleartext: false,
        allowNavigation: ['*'],
      }
    : {
        // 生产环境：保持现有配置
        androidScheme: 'https',
        iosScheme: 'https',
      },
  // ... 其他配置
};
```

#### 配置说明
- **开发环境**：连接到Cloudflare Tunnel公网域名，支持热重载
- **生产环境**：使用本地打包资源
- **自动切换**：根据 `NODE_ENV` 环境变量自动切换

### 🚨 故障排除

#### 问题：Xcode编译失败
```bash
yarn setup:ios
```

#### 问题：手机不刷新
```bash
yarn hotreload:ios
```

#### 问题：需要重新安装
```bash
yarn reload:ios
```

#### 问题：Capacitor配置不同步
```bash
yarn ios:sync
```

### ✅ 验证成功
1. 修改 `src/app/[locale]/page.tsx` 中的文字
2. 保存文件
3. 手机屏幕立即更新

## 🌐 Cloudflare Tunnel配置

### 📖 完整文档
所有Cloudflare Tunnel相关配置请参考：
**[docs/CLOUDFLARE_TUNNEL_GUIDE.md](../docs/CLOUDFLARE_TUNNEL_GUIDE.md)**

### 🎯 快速使用

#### 1. 安装cloudflared
```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# 其他系统参考官方文档
```

#### 2. 临时测试（最简单）
```bash
# 启动前端博客开发服务
yarn dev

# 新开终端，暴露到公网
yarn dev:tunnel
```

#### 3. 完整配置（永久域名）
```bash
# 登录授权
cloudflared tunnel login

# 创建隧道
cloudflared tunnel create lucky-nest-monorepo

# 更新配置文件
# 编辑 cloudflared.yml，替换隧道ID

# 启动隧道
yarn dev:tunnel
```

### 📡 可用域名
| 服务 | 本地端口 | 公网域名 |
|------|----------|----------|
| 前端博客 | 3002 | `https://dev.joyminis.com` |
| Admin 后台 | 3001 | `https://dev.admin.joyminis.com` |
| API 服务 | 3002 | `https://dev.api.joyminis.com` |

### ⚠️ 注意事项
1. **开发服务必须运行**：隧道只是代理，本地开发服务必须已经启动
2. **热重载正常工作**：Cloudflare Tunnel完美支持WebSocket，Next.js热重载工作正常
3. **无需重启隧道**：修改代码时隧道保持连接，只有修改配置才需要重启

## 🏗️ 架构设计

### 统一平台适配器架构

#### 核心设计理念

项目采用**统一平台适配器架构**，通过运行时环境检测和平台感知的React Query层，实现一次开发、多平台部署。该架构解决了传统多平台开发中的代码重复、维护困难、性能不一致等问题。

#### 架构层次

```
┌─────────────────────────────────────────────────────────┐
│                   应用层 (Application)                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 页面组件 (Pages) │ 业务组件 (Components) │ 路由 (Router) │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────┐
│             平台感知层 (Platform-Aware Layer)             │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 平台感知Hooks │ 平台感知Query │ 平台感知Mutation │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────┐
│             平台适配器层 (Platform Adapters)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Web适配器   │  │ H5适配器     │  │ App适配器   │  │
│  │ (Next.js)   │  │ (Mobile Web) │  │ (Capacitor) │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ 缓存策略     │  │ 网络策略     │  │ 设备能力     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────┐
│             运行时环境 (Runtime Environment)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ Web浏览器    │  │ 移动浏览器   │  │ 原生应用     │  │
│  │ (Desktop)   │  │ (Mobile)    │  │ (iOS/Android)│  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### 平台适配器核心特性

1. **运行时环境检测**: 自动检测当前运行环境（Web/H5/Capacitor/Server）
2. **平台感知的React Query**: 根据平台特性自动调整缓存策略、重试机制、网络降级
3. **Server Actions自动降级**: 支持Server Actions的平台优先使用，不支持时自动降级到API调用
4. **统一API接口**: 所有平台使用相同的API接口，适配器处理平台差异
5. **渐进式增强**: 根据平台能力提供最佳用户体验

## 🛠️ 技术栈

### 前端

- **框架**: Next.js 15 (App Router)
- **UI库**: React 18 + TypeScript
- **样式**: Tailwind CSS 3 + Framer Motion
- **状态管理**: Zustand + React Query
- **国际化**: next-intl
- **认证**: 自定义OAuth认证

### 后端集成

- **API客户端**: Axios + 拦截器
- **缓存**: React Query + Cloudflare CDN
- **实时通信**: WebSocket

### 移动端

- **跨平台**: Capacitor 6
- **原生插件**: 相机、地理位置、推送通知
- **存储**: Capacitor Preferences + AsyncStorage

### 基础设施

- **CDN**: Cloudflare (全球边缘网络)
- **部署**: Cloudflare Pages + Workers
- **监控**: Sentry + Cloudflare Analytics
- **CI/CD**: GitLab CI

## 📦 项目结构

```
apps/frontend-blog/
├── src/
│   ├── app/                    # Next.js App Router 页面
│   │   ├── [locale]/          # 国际化路由
│   │   │   ├── layout.tsx     # 布局组件
│   │   │   ├── page.tsx       # 首页
│   │   │   ├── articles/      # 文章页面
│   │   │   ├── categories/    # 分类页面
│   │   │   ├── search/        # 搜索页面
│   │   │   └── ...           # 其他页面
│   │   ├── api/               # API 路由
│   │   └── oauth/             # OAuth 认证路由
│   ├── components/            # React 组件
│   │   ├── ui/               # 可复用UI组件
│   │   ├── blog/             # 博客特定组件
│   │   ├── auth/             # 认证组件
│   │   └── shared/           # 共享组件
│   ├── lib/                  # 工具库
│   │   ├── api/              # API 客户端
│   │   ├── hooks/            # 自定义React Hooks
│   │   ├── utils/            # 工具函数
│   │   └── providers/        # Context Providers
│   ├── messages/             # i18n 翻译文件
│   ├── types/                # TypeScript 类型定义
│   └── styles/               # 全局样式
├── public/                   # 静态资源
├── scripts/                  # 构建和部署脚本
└── tests/                    # 测试文件
```

## 🌐 部署指南

### Cloudflare 部署配置

项目使用 `wrangler.toml` 进行 Cloudflare Workers 配置：

```toml
# 主要配置
name = "joymini-blog-prod"
compatibility_date = "2026-03-20"
compatibility_flags = ["nodejs_compat"]

# 路由配置
[[routes]]
pattern = "blog.joyminis.com/*"
zone_name = "joyminis.com"

[[routes]]
pattern = "blog-dev.joyminis.com/*"
zone_name = "joyminis.com"

# KV 命名空间缓存
[[kv_namespaces]]
binding = "CACHE"
id = "cache-store"
preview_id = "cache-store-preview"

[[kv_namespaces]]
binding = "ISR_CACHE"
id = "isr-cache-store"
preview_id = "isr-cache-store-preview"

# 环境变量
[vars]
NODE_ENV = "production"
NEXT_PUBLIC_ENVIRONMENT = "cloudflare"
ENABLE_ISR = "true"
ENABLE_STREAMING = "true"
```

### 部署命令

```bash
# 构建 Cloudflare 版本
yarn build:cloudflare

# 部署到 Cloudflare
yarn deploy:cloudflare

# 部署预览环境
yarn deploy:cloudflare:preview

# 部署生产环境
yarn deploy:cloudflare:production
```

### 环境变量

| 变量名                    | 描述           | 默认值                     |
| ------------------------- | -------------- | -------------------------- |
| `NEXT_PUBLIC_API_URL`     | API 基础URL    | `https://api.joyminis.com` |
| `NEXT_PUBLIC_CDN_URL`     | CDN URL        | `https://img.joyminis.com` |
| `NEXT_PUBLIC_ENVIRONMENT` | 环境标识       | `cloudflare`               |
| `ENABLE_ISR`              | 启用ISR缓存    | `true`                     |
| `ENABLE_STREAMING`        | 启用流式渲染   | `true`                     |
| `AUTH_COOKIE_DOMAIN`      | 认证Cookie域名 | `.joyminis.com`            |

## 🎯 性能优化

### 缓存策略

```typescript
// 四层缓存架构
1. Cloudflare CDN (边缘): 静态资源1小时TTL
2. ISR缓存 (边缘Worker): 内容5-60分钟TTL
3. 浏览器缓存: JS/CSS 1天，图片7天
4. Service Worker: 关键资源离线回退
```

### 图片优化

- **Next.js Image**: 自动格式转换
- **Cloudflare Images**: 全球CDN + 优化
- **懒加载**: Intersection Observer
- **模糊占位符**: 低质量图片占位

### 性能目标

- **LCP (最大内容绘制)**: < 2.5秒
- **FCP (首次内容绘制)**: < 1.0秒
- **CLS (累积布局偏移)**: < 0.1
- **TTFB (首字节时间)**: < 200毫秒
- **页面切换**: < 300毫秒

## 🧪 测试策略

### 测试套件

```bash
# 运行所有测试
yarn test

# 监听模式运行测试
yarn test:watch

# 运行覆盖率测试
yarn test:coverage

# 运行E2E测试
yarn test:e2e

# E2E调试模式
yarn test:e2e:debug
```

### 测试类型

- **单元测试**: Vitest + Testing Library
- **集成测试**: Playwright
- **性能测试**: Lighthouse CI
- **E2E测试**: Playwright 真实浏览器

## 📊 监控与分析

### 性能监控

- **核心Web指标**: 真实用户监控 (RUM)
- **错误追踪**: Sentry 集成
- **业务指标**: 自定义事件追踪
- **服务器监控**: Cloudflare Analytics

### 健康检查

```bash
# API健康检查
curl -f https://blog.joyminis.com/api/health

# 性能审计
yarn performance-audit
```

## 🔧 开发指南

### 代码质量

- **TypeScript**: 严格模式启用
- **ESLint**: Airbnb配置 + 自定义规则
- **Prettier**: 一致的代码格式化
- **Husky**: 预提交钩子

### 提交规范

```
feat:     新功能
fix:      错误修复
docs:     文档更新
style:    代码样式更改
refactor: 代码重构
test:     测试相关
chore:    构建过程或工具
```

### 分支策略

- `main`: 生产就绪代码
- `develop`: 集成分支
- `feature/*`: 新功能
- `fix/*`: 错误修复
- `release/*`: 发布准备

## 🤝 贡献指南

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目基于 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- Next.js 团队提供的优秀框架
- Vercel 