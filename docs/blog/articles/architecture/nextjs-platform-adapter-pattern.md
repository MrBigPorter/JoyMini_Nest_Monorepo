# 三端统一架构：Next.js 平台适配器模式

> 同一个 Next.js 应用，同时运行在 Web 网站、H5 移动端、原生 App 中——听起来像是天方夜谭，但平台适配器模式让它变成了现实。

---

Tags: Next.js, Architecture, Platform Adapter, Mobile

---

## 1. 背景：为什么一个博客需要三端适配？

我们遇到的场景其实很普遍：**一个 Next.js 博客，同时面临三个终端的需求**。

| 终端 | 渲染模式 | 核心要求 |
|------|---------|---------|
| Web 网站 | SSR/ISR | SEO、首屏速度、边缘缓存 |
| H5 移动端 | SSG | 轻量、快速加载、渐进增强 |
| 原生 App (Capacitor) | CSR | 离线存储、本地功能、API 降级 |

一开始，我们的代码里充满了这样的判断：

```typescript
// ❌ 分散在各处的平台判断
if (isCapacitor) {
  // App 处理
} else {
  // Web 处理
}

// ❌ 重复的降级逻辑
async function saveData() {
  if (isCapacitor) {
    // Capacitor 存储
  } else {
    // localStorage
  }
}
```

这种"散装"的平台判断带来了几个严重问题：

1. **维护困难** — 新增一个平台，需要搜索所有 `isCapacitor` 判断
2. **逻辑不一致** — 每个功能各自写降级逻辑，行为不统一
3. **测试成本高** — 无法 Mock 平台环境，每个测试都要模拟完整环境
4. **平台切换成本高** — 从 WebView 切换到原生时，需要大量改造

我们需要一种**统一的、可扩展的**方式来处理平台差异。

---

## 2. 架构设计：三层解耦

### 2.1 整体架构

```
┌─────────────────────────────────────────────────┐
│                 业务组件层                        │
│   (统一接口调用，不关心平台差异)                  │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│             平台适配器层                          │
│   ┌─────────────┬─────────────┬─────────────┐   │
│   │  Web适配器  │  H5适配器   │ App适配器    │   │
│   │  (SSR/ISR)  │ (SSG/CSR)   │ (CSR/本地)  │   │
│   └─────────────┴─────────────┴─────────────┘   │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│             平台检测层                          │
│    ┌─────────┐   ┌─────────┐   ┌─────────┐    │
│    │运行时检测│   │特性检测  │   │环境检测  │    │
│    └─────────┘   └─────────┘   └─────────┘    │
└─────────────────────────────────────────────────┘
```

**核心原则**：业务层不关心平台差异，适配器层统一接口，检测层自动识别。

### 2.2 目录结构

```
apps/frontend-blog/src/lib/platform/
├── adapters/                    # 平台适配器实现
│   ├── web.adapter.ts           # Web (SSR/ISR)
│   ├── h5.adapter.ts            # H5 (SSG/CSR)
│   ├── capacitor.adapter.ts     # App (Capacitor)
│   └── server.adapter.ts        # Server端 (SSR期间)
│
├── detectors/                   # 平台检测器
│   ├── runtime.detector.ts      # 运行时检测
│   ├── feature.detector.ts      # 特性检测
│   └── environment.detector.ts  # 环境检测
│
├── factories/                   # 工厂类
│   ├── adapter-factory.ts       # 适配器工厂
│   ├── service-factory.ts       # 服务工厂
│   └── strategy-factory.ts      # 策略工厂
│
├── strategies/                  # 降级策略
│   ├── isr.strategy.ts          # ISR降级策略
│   ├── server-action.strategy.ts # Server Action降级
│   ├── cache.strategy.ts        # 缓存降级策略
│   └── navigation.strategy.ts   # 导航降级策略
│
├── services/                    # 平台服务
│   ├── navigation.service.ts    # 导航服务
│   ├── storage.service.ts       # 存储服务
│   ├── network.service.ts       # 网络服务
│   └── rendering.service.ts     # 渲染服务
│
├── types.ts                     # 类型定义
├── constants.ts                 # 常量配置
└── index.ts                     # 统一入口
```

---

## 3. 核心接口：所有平台必须实现的契约

### 3.1 平台适配器接口

```typescript
export interface IPlatformAdapter {
  readonly platform: "web" | "h5" | "capacitor" | "server";

  navigation: {
    goTo(url: string, options?: NavigationOptions): Promise<void> | void;
    back(): Promise<void> | void;
    getCurrentRoute(): Promise<RouteInfo> | RouteInfo;
  };

  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    clear(): Promise<void>;
  };

  network: {
    executeAction<T>(action: () => Promise<T>): Promise<T>;
    executeActionWithFallback<T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>,
    ): Promise<T>;
    supportsServerActions(): boolean;
  };

  rendering: {
    getISRConfig(): number | false;
    supportsSSR(): boolean;
    supportsStreaming(): boolean;
    getPrefetchStrategy(): PrefetchStrategy;
  };

  device: {
    getInfo(): Promise<DeviceInfo>;
    supportsPush(): boolean;
    supportsCamera(): boolean;
  };
}
```

这个接口定义了 5 个核心领域：**导航、存储、网络、渲染、设备能力**。每个平台适配器都必须实现所有方法。

### 3.2 设计要点

为什么把接口划分成这 5 个领域？

| 领域 | 解决的问题 | Web 实现 | App 实现 |
|------|-----------|---------|---------|
| 导航 | 路由跳转、返回、获取路由 | `window.location` | `@capacitor/app` |
| 存储 | 本地数据持久化 | `localStorage` | `@capacitor/preferences` |
| 网络 | Server Actions、API 调用 | 直接执行 SA | 降级为 API 调用 |
| 渲染 | ISR、SSR、流式渲染 | 全部支持 | 都不支持 (CSR) |
| 设备 | 推送通知、相机等功能 | 有限支持 | 原生支持 |

---

## 4. 平台检测：运行时自动识别

### 4.1 检测策略

```typescript
export class RuntimeDetector {
  static detect(): PlatformRuntime {
    if (typeof window === "undefined") {
      return { type: "server", capabilities: ["ssr"] };
    }

    if ("Capacitor" in window) {
      return { type: "capacitor", capabilities: ["native", "local-storage"] };
    }

    // 移动端 Web 检测
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      return { type: "h5", capabilities: ["ssg", "csr"] };
    }

    return { type: "web", capabilities: ["ssr", "isr", "server-actions"] };
  }
}
```

检测优先级：**Server** → **Capacitor App** → **H5 移动端** → **Web 桌面端**

### 4.2 适配器工厂

```typescript
export class PlatformAdapterFactory {
  private static instance: IPlatformAdapter | null = null;

  static getAdapter(): IPlatformAdapter {
    if (this.instance) return this.instance;

    const runtime = RuntimeDetector.detect();
    const features = RuntimeDetector.detectFeatures();

    switch (runtime.type) {
      case "server":
        this.instance = new ServerAdapter(runtime, features);
        break;
      case "web":
        this.instance = new WebAdapter(runtime, features);
        break;
      case "h5":
        this.instance = new H5Adapter(runtime, features);
        break;
      case "capacitor":
        this.instance = new CapacitorAdapter(runtime, features);
        break;
      default:
        this.instance = new WebAdapter(runtime, features);
    }

    return this.instance;
  }

  static refresh(): void {
    this.instance = null;
    this.getAdapter();
  }
}
```

**单例模式**：适配器在整个应用生命周期内只创建一次，通过 `refresh()` 方法在环境变化时重新检测。

---

## 5. 降级策略：优雅应对能力差异

### 5.1 ISR 降级

不同平台对 ISR 的支持能力完全不同：

```typescript
// Web 端：60 秒 ISR
rendering = {
  getISRConfig: () => 60,
  supportsSSR: () => true,
  supportsStreaming: () => true,
};

// H5 端：更长缓存（静态生成）
rendering = {
  getISRConfig: () => 600, // 10 分钟
  supportsSSR: () => false,
  supportsStreaming: () => false,
};

// App 端：不支持 ISR
rendering = {
  getISRConfig: () => false,
  supportsSSR: () => false,
  supportsStreaming: () => false,
};
```

### 5.2 Server Actions 降级

这是最有意思的部分。Web 端可以直接使用 Next.js 的 Server Actions，但 App 端不支持。适配器层自动处理这个差异：

```typescript
export class ServerActionStrategy {
  static create<T, P extends any[]>(
    serverAction: (...args: P) => Promise<T>,
    apiFallback: (...args: P) => Promise<T>,
  ): (...args: P) => Promise<T> {
    return async (...args: P) => {
      const adapter = PlatformAdapterFactory.getAdapter();

      if (adapter.network.supportsServerActions()) {
        try {
          return await serverAction(...args);
        } catch (error) {
          console.warn("Server Action 失败，降级到 API 调用:", error);
          return await apiFallback(...args);
        }
      } else {
        console.info("平台不支持 Server Actions，使用 API 降级");
        return await apiFallback(...args);
      }
    };
  }
}
```

**使用示例** — 收藏功能：

```typescript
const bookmarkAction = ServerActionStrategy.create(
  // Server Action（Web 端）
  async (articleId: string) => {
    "use server";
    return await toggleBookmark(articleId);
  },
  // API Fallback（App/H5 端）
  async (articleId: string) => {
    const response = await fetch("/api/bookmarks/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId }),
    });
    return response.json();
  },
);
```

### 5.3 Capacitor 存储降级

```typescript
storage = {
  get: async (key: string) => {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      const { value } = await Preferences.get({ key });
      return value;
    } catch (error) {
      // 降级到 localStorage
      console.warn("Capacitor 存储失败，降级到 localStorage:", error);
      if (typeof window !== "undefined") {
        return localStorage.getItem(key);
      }
      return null;
    }
  },
  // ... set, remove, clear 同理
};
```

**关键设计**：降级不是静默失败，而是**记录日志 + 切换后备方案**。这样在开发和生产环境中都能追踪到降级事件。

---

## 6. 迁移前后对比

| 功能 | 迁移前 | 迁移后 |
|------|--------|--------|
| **平台检测** | 分散的 `isCapacitor` 判断 | 统一的 `PlatformAdapterFactory.getAdapter()` |
| **存储系统** | 硬编码的 localStorage/Capacitor | `platform.storage.get/set/remove` |
| **Server Actions** | 只能 Web 端使用 | 自动降级：Web(SA) → App(API) |
| **ISR 配置** | 固定的 `revalidate` 值 | 自适应：Web(60s) → H5(600s) → App(false) |
| **导航系统** | 混合使用路由/window.location | 统一的 `platform.navigation.goTo()` |
| **错误处理** | 每个功能自己处理 | 适配器统一降级 + 错误恢复 |

---

## 7. 实施路径

### 阶段一：基础搭建（1-2 天）
1. 创建平台适配层目录结构
2. 实现核心接口和类型定义
3. 完成平台检测器和工厂
4. 实现 Web 和 App 适配器基础版本

### 阶段二：服务迁移（2-3 天）
1. 迁移存储系统：统一使用 `platform.storage`
2. 迁移导航系统：统一使用 `platform.navigation`
3. 迁移网络请求：统一使用 `platform.network`

### 阶段三：业务组件适配（3-5 天）
1. 页面组件 ISR 配置：使用 `ISRStrategy.applyToPage()`
2. 交互功能 Server Actions：使用 `ServerActionStrategy.create()`
3. 数据获取 Hook：集成平台感知的缓存策略

### 阶段四：测试与优化（2-3 天）
1. 三端兼容性测试：Web、H5、App
2. 降级策略验证
3. 性能基准测试

---

## 8. 总结

平台适配器模式最核心的价值不是"解决平台差异"，而是**让业务代码不需要知道平台差异的存在**。

好的架构不是让开发者觉得强大，而是让开发者觉得简单。当你的 Next.js 应用需要在 Web、H5、App 三端运行时，平台适配器模式是一个值得投入的架构投资。
