---
title: Next.js PWA 实战：一步步实现可安装离线博客
slug: nextjs-pwa-installable-offline-blog
tags: Next.js, PWA, Mobile, Performance
---

# Next.js PWA 实战：一步步实现可安装离线博客

> 给一个 Next.js 博客添加 PWA 支持，使其可安装到手机主屏幕并支持离线访问。涵盖 Manifest 配置、Service Worker 缓存策略、多语言支持、Lighthouse 满分验证，以及与 Capacitor 原生应用的兼容处理。

---

## 1. 为什么需要 PWA？

PWA（Progressive Web App）能让 Web 应用拥有接近原生应用的体验。对于博客来说，PWA 带来的核心价值：

- **添加到主屏幕** — 用户在手机浏览器上访问博客后，可以像安装 App 一样添加到桌面
- **离线访问** — 已缓存的文章在没有网络时也能阅读
- **更快的重复访问** — Service Worker 缓存使二次加载接近瞬间
- **Lighthouse PWA 评分 100 分** — 作为技术博客，PWA 本身就是最佳实践的直接证明

## 2. 技术选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| `next-pwa` | 官方维护，Next.js 集成最佳 | 配置相对复杂 | ✅ **选择** |
| `@ducanh2912/next-pwa` | 社区活跃，兼容性好 | 文档较少 | 备选 |
| 手动实现 | 完全可控 | 开发维护成本高 | 不推荐 |

### PWA 整体架构

```
PWA 架构层
├── 1. Web App Manifest
│   ├── 多语言 manifest（中文/英文）
│   ├── 多尺寸应用图标
│   └── 主题颜色 / 启动画面
├── 2. Service Worker
│   ├── 静态资源缓存策略（CacheFirst）
│   ├── API 响应缓存策略（NetworkFirst）
│   └── 离线回退页面
├── 3. PWA 客户端组件
│   ├── InstallPrompt（安装提示）
│   ├── OfflineIndicator（离线指示器）
│   └── UpdateAvailable（更新提示）
└── 4. 配置层
    ├── next.config.ts PWA 插件配置
    └── 环境变量 PWA 开关
```

## 3. 核心实现

### 3.1 依赖安装

```bash
cd apps/frontend-blog
yarn add next-pwa
```

### 3.2 next.config.ts 集成

```typescript
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    // 自定义缓存策略
  ],
});

export default withPWA(withNextIntl(nextConfig));
```

关键配置说明：
- `disable: development` — 开发环境禁用 PWA，避免缓存干扰调试
- `skipWaiting: true` — Service Worker 更新后立即激活，不等用户关闭所有标签
- `dest: "public"` — 构建时自动生成 Service Worker 文件到 `public/` 目录

### 3.3 Web App Manifest 配置

```json
{
  "name": "JoyMinis Blog",
  "short_name": "JoyMinis",
  "description": "技术博客 - 探索前端与全栈开发",
  "theme_color": "#3b82f6",
  "background_color": "#ffffff",
  "display": "standalone",
  "orientation": "portrait",
  "scope": "/",
  "start_url": "/?source=pwa",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

`purpose: "maskable"` 是关键 — 这告诉浏览器图标是自适应图标，在不同的 Android 系统上会自动适配圆形/方形裁剪。

### 3.4 缓存策略设计

| 资源类型 | 缓存策略 | 过期时间 | 说明 |
|----------|----------|----------|------|
| 静态资源 | CacheFirst | 30 天 | CSS/JS/字体/图片 |
| API 响应 | NetworkFirst | 5 分钟 | 优先请求网络，失败用缓存 |
| 页面路由 | NetworkFirst | 1 小时 | 支持离线浏览已访问页面 |
| 核心资源 | StaleWhileRevalidate | 7 天 | 关键 JS/CSS，后台更新 |
| 图片资源 | CacheFirst | 30 天 | 图片变化不频繁 |

**策略选择逻辑：**
- `CacheFirst`：只从缓存读取，没有才请求网络。适合版本化、不变更的静态资源。
- `NetworkFirst`：优先请求网络，失败时回退到缓存。适合动态数据，确保用户看到最新内容。
- `StaleWhileRevalidate`：先返回缓存，同时在后台请求更新。适合"稍旧也能接受，但最终要更新"的资源。

### 3.5 多语言 Manifest

Service Worker 和 Manifest 面临一个经典挑战：**Manifest 不支持运行时语言切换**。

解决方案是准备多个语言版本的 Manifest 文件：

```
public/
├── manifest.json        # 默认
├── manifest-zh.json     # 中文
└── manifest-en.json     # 英文
```

然后在根布局中动态加载：

```tsx
// app/[locale]/layout.tsx
<link rel="manifest" href={`/manifest-${locale}.json`} />
<meta name="theme-color" content="#3b82f6" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

## 4. PWA 客户端组件

### 4.1 InstallPrompt（安装提示）

当用户满足 PWA 安装条件时（访问超过 30 秒、有交互等），浏览器会触发 `beforeinstallprompt` 事件。我们需要捕获该事件，在适当时机显示安装按钮：

```tsx
function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt) return null;

  return <button onClick={() => deferredPrompt.prompt()}>安装到桌面</button>;
}
```

### 4.2 OfflineIndicator（离线指示器）

通过 `navigator.onLine` 和 `window` 的 `online`/`offline` 事件检测网络状态：

```typescript
function useOffline() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOffline;
}
```

### 4.3 UpdateAvailable（更新提示）

当 Service Worker 检测到新版本时，弹出提示让用户刷新：

```typescript
useEffect(() => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // 新版本已激活，提示用户刷新
      setShowUpdate(true);
    });
  }
}, []);
```

## 5. 水合风险防范

PWA 功能大量依赖浏览器 API，在 Next.js SSR 环境中需要额外小心：

| 风险点 | 防护措施 |
|--------|----------|
| Service Worker 注册 | 在 `useEffect` 中注册，SSR 阶段不执行 |
| 安装提示 API 检测 | 使用 `useIsClient` Hook 包裹 |
| Manifest 动态加载 | 客户端检测语言后加载 |
| 离线状态检测 | 封装在 `useOffline` Hook 中 |

## 6. Capacitor 兼容性

博客同时通过 Capacitor 打包为 iOS/Android 原生应用。在原生应用中启用 PWA 会导致功能冲突：

```typescript
const shouldEnablePWA = () => {
  if (typeof window === "undefined") return false;
  if (window.Capacitor && window.Capacitor.getPlatform() !== "web") {
    return false; // 原生 App 禁用 PWA
  }
  return true;
};
```

## 7. 成功指标

| 指标 | 目标值 | 验证方法 |
|------|--------|----------|
| Lighthouse PWA 评分 | 100 分 | Chrome DevTools Audit |
| 离线功能可用性 | 核心页面可访问 | 手动飞行模式测试 |
| 缓存命中率 | >80% | Service Worker 日志 |
| 重复访问加载 | <1 秒 | Web Vitals 监控 |

## 8. 实施路线

### 第一阶段（立即实施）
- 基础 PWA 配置（manifest + service worker）
- 核心缓存策略
- 离线回退页面

### 第二阶段（1-2 天后）
- PWA 功能组件（安装提示、离线指示器）
- 多语言 manifest 支持
- 性能优化和缓存调优

### 第三阶段（规划中）
- 推送通知集成（Web Push）
- 预缓存策略
- 分析监控集成

## 9. 总结

PWA 让一个 Web 博客获得了接近原生应用的体验。关键经验：

1. **`next-pwa` 是最省心的方案** — 比自己手写 Service Worker 少踩很多坑
2. **多语言 Manifest 需要额外处理** — Manifest 本身不支持运行时切换，需要多文件方案
3. **兼容性考虑要前置** — 如果同时有 Capacitor 原生打包，需要提前规划 PWA 的启用策略
4. **缓存策略的选择要精细化** — 不是所有资源都用同一种策略，根据资源类型和更新频率差异化配置
5. **水合风险是 Next.js 下的常见问题** — 所有浏览器 API 调用都要保护好
