# 平台适配器统一架构设计

> 🎯 **目标**: 建立统一的三端平台适配层，实现"一次编写，三端运行"
> 📅 **创建日期**: 2026-04-18
> 👨‍💻 **作者**: AI协作系统
> 📋 **状态**: 架构设计中

---

## 🎯 核心目标

### 三端统一适配

- **Web网站 (SSR)**: 充分利用Next.js特性（ISR、Server Actions、边缘缓存）
- **H5移动端 (SSG)**: 静态生成+客户端增强，渐进式体验
- **原生App (CSR)**: Capacitor打包，本地存储+API降级

### 统一架构原则

1. **一处检测，多处使用**: 平台检测逻辑集中管理
2. **接口统一，实现分离**: 统一API接口，不同平台不同实现
3. **渐进增强，优雅降级**: Web → H5 → App 逐步降级
4. **平台透明，业务无感**: 业务代码不关心平台差异

---

## 🔍 现有问题分析

### 当前架构问题

| 问题             | 现状                         | 影响                 |
| ---------------- | ---------------------------- | -------------------- |
| **平台检测分散** | `isCapacitor`判断散落在各处  | 维护困难，容易遗漏   |
| **降级处理混乱** | 每个功能都要写自己的降级逻辑 | 代码重复，逻辑不一致 |
| **平台特性耦合** | 业务代码直接调用平台API      | 平台切换成本高       |
| **无统一适配器** | 只有零散的平台工具函数       | 无法统一管理平台差异 |

### 技术债务

```typescript
// ❌ 分散在各处的平台判断
if (isCapacitor) {
  // App处理
} else {
  // Web处理
}

// ❌ 重复的降级逻辑
async function saveData() {
  if (isCapacitor) {
    // Capacitor存储
  } else {
    // localStorage
  }
}
```

---

## 🏗️ 架构设计方案

### 整体架构

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

### 目录结构

```
apps/frontend-blog/src/lib/platform/
├── adapters/                    # 🔹 平台适配器实现
│   ├── web.adapter.ts           # Web平台适配器 (SSR/ISR)
│   ├── h5.adapter.ts            # H5平台适配器 (SSG/CSR)
│   ├── capacitor.adapter.ts     # App平台适配器 (Capacitor)
│   └── server.adapter.ts        # Server端适配器 (SSR期间)
│
├── detectors/                   # 🔹 平台检测器
│   ├── runtime.detector.ts      # 运行时检测
│   ├── feature.detector.ts      # 特性检测
│   └── environment.detector.ts  # 环境检测
│
├── factories/                   # 🔹 工厂类
│   ├── adapter-factory.ts       # 适配器工厂
│   ├── service-factory.ts       # 服务工厂
│   └── strategy-factory.ts      # 策略工厂
│
├── strategies/                  # 🔹 降级策略
│   ├── isr.strategy.ts          # ISR降级策略
│   ├── server-action.strategy.ts # Server Action降级策略
│   ├── cache.strategy.ts        # 缓存降级策略
│   └── navigation.strategy.ts   # 导航降级策略
│
├── services/                    # 🔹 平台服务
│   ├── navigation.service.ts    # 导航服务
│   ├── storage.service.ts       # 存储服务
│   ├── network.service.ts       # 网络服务
│   └── rendering.service.ts     # 渲染服务
│
├── types.ts                     # 🔹 类型定义
├── constants.ts                 # 🔹 常量配置
└── index.ts                     # 🔹 统一入口
```

---

## 🔧 核心组件设计

### 1. 平台适配器接口 (`types.ts`)

```typescript
/**
 * 平台适配器统一接口
 * 所有平台必须实现此接口
 */
export interface IPlatformAdapter {
  // === 平台基本信息 ===
  readonly platform: "web" | "h5" | "capacitor" | "server";
  readonly version: string;

  // === 导航系统 ===
  navigation: {
    /** 跳转到指定URL */
    goTo(url: string, options?: NavigationOptions): Promise<void> | void;

    /** 返回上一页 */
    back(): Promise<void> | void;

    /** 获取当前路由信息 */
    getCurrentRoute(): Promise<RouteInfo> | RouteInfo;
  };

  // === 存储系统 ===
  storage: {
    /** 获取存储项 */
    get(key: string): Promise<string | null>;

    /** 设置存储项 */
    set(key: string, value: string): Promise<void>;

    /** 删除存储项 */
    remove(key: string): Promise<void>;

    /** 清空存储 */
    clear(): Promise<void>;
  };

  // === 网络系统 === (Server Actions降级核心)
  network: {
    /** 执行Server Action（自动降级到API调用） */
    executeAction<T>(action: () => Promise<T>): Promise<T>;

    /** 带fallback的Server Action */
    executeActionWithFallback<T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>,
    ): Promise<T>;

    /** 检查是否支持Server Actions */
    supportsServerActions(): boolean;
  };

  // === 渲染系统 === (ISR/SSR降级核心)
  rendering: {
    /** 获取ISR配置（false表示不支持） */
    getISRConfig(): number | false;

    /** 检查是否支持SSR */
    supportsSSR(): boolean;

    /** 检查是否支持流式渲染 */
    supportsStreaming(): boolean;

    /** 获取预取策略 */
    getPrefetchStrategy(): PrefetchStrategy;
  };

  // === 设备功能 ===
  device: {
    /** 获取设备信息 */
    getInfo(): Promise<DeviceInfo>;

    /** 检查是否支持推送通知 */
    supportsPush(): boolean;

    /** 检查是否支持相机 */
    supportsCamera(): boolean;
  };

  // === 日志系统 ===
  logger: {
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, data?: any): void;
  };
}
```

### 2. 平台检测器 (`detectors/`)

```typescript
// runtime.detector.ts
export class RuntimeDetector {
  /** 检测运行时环境 */
  static detect(): PlatformRuntime {
    if (typeof window === "undefined") {
      return { type: "server", capabilities: ["ssr"] };
    }

    if ("Capacitor" in window) {
      return { type: "capacitor", capabilities: ["native", "local-storage"] };
    }

    // 移动端Web检测
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      return { type: "h5", capabilities: ["ssg", "csr"] };
    }

    return { type: "web", capabilities: ["ssr", "isr", "server-actions"] };
  }

  /** 检测可用特性 */
  static detectFeatures(): PlatformFeature[] {
    const features: PlatformFeature[] = [];

    // 检测Server Actions支持
    if (typeof window === "undefined" || "next" in window) {
      features.push("server-actions");
    }

    // 检测ISR支持
    if (typeof window === "undefined") {
      features.push("isr");
    }

    // 检测Capacitor特性
    if ("Capacitor" in window) {
      features.push("native-storage", "push-notifications", "camera");
    }

    return features;
  }
}
```

### 3. 适配器工厂 (`factories/adapter-factory.ts`)

```typescript
export class PlatformAdapterFactory {
  /** 单例实例 */
  private static instance: IPlatformAdapter | null = null;

  /** 获取平台适配器 */
  static getAdapter(): IPlatformAdapter {
    if (this.instance) {
      return this.instance;
    }

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
        // 默认降级到Web适配器
        this.instance = new WebAdapter(runtime, features);
    }

    return this.instance;
  }

  /** 重新检测并更新适配器（用于热重载或环境变化） */
  static refresh(): void {
    this.instance = null;
    this.getAdapter();
  }
}
```

### 4. Web平台适配器 (`adapters/web.adapter.ts`)

```typescript
export class WebAdapter implements IPlatformAdapter {
  readonly platform = "web" as const;
  readonly version = "1.0.0";

  constructor(
    private readonly runtime: PlatformRuntime,
    private readonly features: PlatformFeature[],
  ) {}

  // === 导航系统 ===
  navigation = {
    goTo: (url: string) => {
      // Web端使用Next.js路由
      if (typeof window !== "undefined") {
        window.location.href = url;
      }
    },

    back: () => {
      if (typeof window !== "undefined") {
        window.history.back();
      }
    },

    getCurrentRoute: () => {
      if (typeof window !== "undefined") {
        return {
          path: window.location.pathname,
          query: Object.fromEntries(
            new URLSearchParams(window.location.search),
          ),
        };
      }
      return { path: "/", query: {} };
    },
  };

  // === 存储系统 ===
  storage = {
    get: async (key: string) => {
      if (typeof window === "undefined") return null;
      return localStorage.getItem(key);
    },

    set: async (key: string, value: string) => {
      if (typeof window === "undefined") return;
      localStorage.setItem(key, value);
    },

    remove: async (key: string) => {
      if (typeof window === "undefined") return;
      localStorage.removeItem(key);
    },

    clear: async () => {
      if (typeof window === "undefined") return;
      localStorage.clear();
    },
  };

  // === 网络系统 === (支持Server Actions)
  network = {
    executeAction: async <T>(action: () => Promise<T>) => {
      // Web端直接执行Server Action
      return await action();
    },

    executeActionWithFallback: async <T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>,
    ) => {
      try {
        return await action();
      } catch (error) {
        console.warn("Server Action失败，降级到API调用:", error);
        return await fallback();
      }
    },

    supportsServerActions: () => {
      return this.features.includes("server-actions");
    },
  };

  // === 渲染系统 === (支持ISR/SSR)
  rendering = {
    getISRConfig: () => {
      // Web端支持60秒ISR
      return 60;
    },

    supportsSSR: () => {
      return this.runtime.capabilities.includes("ssr");
    },

    supportsStreaming: () => {
      return true; // Web端支持流式渲染
    },

    getPrefetchStrategy: () => {
      return "hover-intent" as const;
    },
  };

  // ... 其他接口实现
}
```

### 5. App平台适配器 (`adapters/capacitor.adapter.ts`)

```typescript
export class CapacitorAdapter implements IPlatformAdapter {
  readonly platform = "capacitor" as const;
  readonly version = "1.0.0";

  constructor(
    private readonly runtime: PlatformRuntime,
    private readonly features: PlatformFeature[],
  ) {}

  // === 导航系统 ===
  navigation = {
    goTo: async (url: string) => {
      // App端使用Capacitor App插件或WebView导航
      try {
        const { App } = await import("@capacitor/app");
        await App.openUrl({ url });
      } catch (error) {
        // 降级到WebView导航
        if (typeof window !== "undefined") {
          window.location.href = url;
        }
      }
    },

    back: async () => {
      try {
        const { App } = await import("@capacitor/app");
        await App.back();
      } catch (error) {
        // 降级到Web导航
        if (typeof window !== "undefined") {
          window.history.back();
        }
      }
    },

    getCurrentRoute: async () => {
      // App端获取当前路由
      return {
        path: typeof window !== "undefined" ? window.location.pathname : "/",
        query: {},
      };
    },
  };

  // === 存储系统 === (使用Capacitor Preferences)
  storage = {
    get: async (key: string) => {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        const { value } = await Preferences.get({ key });
        return value;
      } catch (error) {
        // 降级到localStorage
        console.warn("Capacitor存储失败，降级到localStorage:", error);
        if (typeof window !== "undefined") {
          return localStorage.getItem(key);
        }
        return null;
      }
    },

    set: async (key: string, value: string) => {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.set({ key, value });
      } catch (error) {
        // 降级到localStorage
        console.warn("Capacitor存储失败，降级到localStorage:", error);
        if (typeof window !== "undefined") {
          localStorage.setItem(key, value);
        }
      }
    },

    remove: async (key: string) => {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.remove({ key });
      } catch (error) {
        // 降级到localStorage
        console.warn("Capacitor存储失败，降级到localStorage:", error);
        if (typeof window !== "undefined") {
          localStorage.removeItem(key);
        }
      }
    },

    clear: async () => {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.clear();
      } catch (error) {
        // 降级到localStorage
        console.warn("Capacitor存储失败，降级到localStorage:", error);
        if (typeof window !== "undefined") {
          localStorage.clear();
        }
      }
    },
  };

  // === 网络系统 === (Server Actions降级为API调用)
  network = {
    executeAction: async <T>(action: () => Promise<T>) => {
      // App端不支持Server Actions，需要降级
      throw new PlatformNotSupportedError(
        "Server Actions are not supported in App",
      );
    },

    executeActionWithFallback: async <T>(
      action: () => Promise<T>,
      fallback: () => Promise<T>,
    ) => {
      // App端直接使用fallback（API调用）
      console.info("App端不支持Server Actions，使用API降级");
      return await fallback();
    },

    supportsServerActions: () => {
      return false; // App端不支持Server Actions
    },
  };

  // === 渲染系统 === (不支持ISR)
  rendering = {
    getISRConfig: () => {
      // App端不支持ISR
      return false;
    },

    supportsSSR: () => {
      return false; // App端是CSR
    },

    supportsStreaming: () => {
      return false; // App端不支持流式渲染
    },

    getPrefetchStrategy: () => {
      return "none" as const; // App端使用本地缓存
    },
  };

  // ... 其他接口实现
}
```

---

## 🚀 降级策略实现

### 1. ISR降级策略 (`strategies/isr.strategy.ts`)

```typescript
export class ISRStrategy {
  /** 获取平台适用的ISR配置 */
  static getConfig(adapter: IPlatformAdapter): number | false {
    const config = adapter.rendering.getISRConfig();

    // 如果平台不支持ISR，返回false
    if (config === false) {
      console.info(`${adapter.platform}平台不支持ISR，使用客户端渲染`);
      return false;
    }

    // Web端：使用配置的ISR时间
    // H5端：使用更长的缓存时间（静态生成）
    // App端：不支持ISR
    switch (adapter.platform) {
      case "web":
        return config; // 例如60秒

      case "h5":
        return config * 10; // 静态页面，更长缓存

      case "capacitor":
      case "server":
      default:
        return false;
    }
  }

  /** 应用ISR配置到页面组件 */
  static applyToPage(pageConfig: PageConfig, adapter: IPlatformAdapter): void {
    const isrConfig = this.getConfig(adapter);

    if (isrConfig !== false) {
      pageConfig.revalidate = isrConfig;
      console.info(`页面配置ISR: ${isrConfig}秒`);
    } else {
      delete pageConfig.revalidate;
      console.info("页面禁用ISR，使用客户端渲染");
    }
  }
}
```

### 2. Server Actions降级策略 (`strategies/server-action.strategy.ts`)

```typescript
export class ServerActionStrategy {
  /** 创建平台感知的Server Action */
  static create<T, P extends any[]>(
    serverAction: (...args: P) => Promise<T>,
    apiFallback: (...args: P) => Promise<T>,
  ): (...args: P) => Promise<T> {
    return async (...args: P) => {
      const adapter = PlatformAdapterFactory.getAdapter();

      if (adapter.network.supportsServerActions()) {
        try {
          // 支持Server Actions的平台
          return await serverAction(...args);
        } catch (error) {
          console.warn("Server Action执行失败，降级到API调用:", error);
          return await apiFallback(...args);
        }
      } else {
        // 不支持Server Actions的平台（如App）
        console.info("平台不支持Server Actions，使用API降级");
        return await apiFallback(...args);
      }
    };
  }

  /** 使用示例：收藏功能 */
  static createBookmarkAction() {
    return this.create(
      // Server Action实现
      async (articleId: string) => {
        "use server";
        // Server Action逻辑
        const result = await toggleBookmark(articleId);
        return result;
      },
      // API Fallback实现
      async (articleId: string) => {
        // API调用逻辑
        const response = await fetch("/api/bookmarks/toggle", {
          method: "POST",
          body: JSON.stringify({ articleId }),
        });
        return response.json();
      },
    );
  }
}
```

---

## 📋 实施迁移指南

### 阶段一：基础适配器搭建（1-2天）

1. **创建平台适配层目录结构**
2. **实现核心接口和类型定义**
3. **完成平台检测器和工厂**
4. **实现Web和App适配器基础版本**

### 阶段二：平台服务迁移（2-3天）

1. **迁移存储系统**：统一使用`platform.storage`
2. **迁移导航系统**：统一使用`platform.navigation`
3. **迁移网络请求**：统一使用`platform.network`
4. **更新现有工具函数**：使用适配器替代硬编码判断

### 阶段三：业务组件适配（3-5天）

1. **页面组件ISR配置**：使用`ISRStrategy.applyToPage()`
2. **交互功能Server Actions**：使用`ServerActionStrategy.create()`
3. **数据获取Hook**：集成平台感知的缓存策略
4. **组件平台特性**：使用`platform.device`检测功能支持

### 阶段四：测试与优化（2-3天）

1. **三端兼容性测试**：Web、H5、App
2. **降级策略验证**：验证各平台的降级逻辑
3. **性能基准测试**：确保适配器不引入性能损耗
4. **文档更新**：更新所有相关文档

---

## 📊 迁移前后对比

| 功能               | 迁移前                             | 迁移后                                      |
| ------------------ | ---------------------------------- | ------------------------------------------- |
| **平台检测**       | 分散的`isCapacitor`判断            | 统一的`PlatformAdapterFactory.getAdapter()` |
| **存储系统**       | 硬编码的localStorage/Capacitor判断 | `platform.storage.get/set/remove`           |
| **Server Actions** | 只能Web端使用                      | 自动降级：Web(SA) → App(API)                |
| **ISR配置**        | 固定的`revalidate`值               | 平台感知：Web(60s) → App(false)             |
| **导航系统**       | 混合使用路由/window.location       | 统一的`platform.navigation.goTo()`          |
| **错误处理**       | 每个功能自己处理                   | 适配器统一降级+错误恢复                     |

---

## 🚨 风险与应对

### 技术风险

1. **性能开销**：适配器层可能引入额外开销
   - **应对**：工厂缓存、懒加载适配器、性能监控

2. **平台检测不准确**：用户代理欺骗等
   - **应对**：特征检测+运行时检测双重验证

3. **降级逻辑复杂**：多级降级难以维护
   - **应对**：清晰的降级策略链、完善的日志

### 业务风险

1. **迁移成本高**：需要修改大量现有代码
   - **应对**：渐进式迁移、兼容层、双跑验证

2. **平台特性丢失**：过度统一可能丢失平台特色
   - **应对**：保留平台扩展点、特性标志检测

### 实施风险

1. **适配器bug影响所有平台**
   - **应对**：完善的单元测试、三端集成测试

2. **版本兼容性问题**
   - **应对**：语义化版本、向后兼容层

---

## 📝 检查清单

### 架构设计检查清单

- [ ] 接口设计是否完整覆盖三端需求？
- [ ] 降级策略是否清晰可维护？
- [ ] 性能开销是否在可接受范围内？
- [ ] 错误处理机制是否健全？
- [ ] 扩展性是否足够？

### 实施检查清单

- [ ] 平台检测器准确性验证
- [ ] 适配器工厂单例实现
- [ ] 各平台适配器基础功能
- [ ] 核心降级策略实现
- [ ] 单元测试覆盖

### 迁移检查清单

- [ ] 存储系统迁移验证
- [ ] 导航系统迁移验证
- [ ] Server Actions降级验证
- [ ] ISR配置迁移验证
- [ ] 三端兼容性测试

---

## 🔗 相关文档

1. [BLOG_LOADING_OPTIMIZATION_IMPLEMENTATION_GUIDE.md](../development/BLOG_LOADING_OPTIMIZATION_IMPLEMENTATION_GUIDE.md) - Loading优化指南
2. [FRONTEND_ARCHITECTURE_LAYERS.md](./FRONTEND_ARCHITECTURE_LAYERS.md) - 前端分层架构
3. [MULTI_MODE_RENDERING_DESIGN.md](../design/MULTI_MODE_RENDERING_DESIGN.md) - 多模式渲染设计
4. [Next.js平台适配最佳实践](https://nextjs.org/docs/app/building-your-application/rendering/platform-adaptation)

---

**文档版本**: 1.0  
**更新日期**: 2026-04-18  
**下一步**: 评审架构设计，开始实施
