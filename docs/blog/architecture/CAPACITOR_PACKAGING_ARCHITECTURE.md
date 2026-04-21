# Lucky Blog Capacitor打包架构方案

## 📋 文档定位

**架构设计文档**：为Lucky Blog设计完整的Capacitor移动应用打包、生成、配置架构方案。

**目标读者**：架构师、全栈开发者、移动端工程师  
**详细程度**：详细完整，包含实施指引和验证指标

**文档状态**：✅ 已完成  
**最后更新**：2026-04-21  
**相关文档**：[FRONTEND_BLOG_ARCHITECTURE.md](./FRONTEND_BLOG_ARCHITECTURE.md)

## 🎯 核心目标

### 1. 业务目标

- 将现有的Next.js博客前端打包为原生移动应用（Android/iOS）
- 保持Web和App代码的高度复用（>90%代码共享）
- 支持渐进式增强：Web优先，App增强
- 实现一次开发，多平台部署

### 2. 技术目标

- **构建系统**：统一Next.js静态导出 + Capacitor原生包装
- **配置管理**：环境感知的构建配置（Web vs App）
- **插件架构**：可扩展的原生功能插件体系
- **部署流水线**：CI/CD自动构建、签名、分发
- **类型安全**：完整的TypeScript类型支持

### 3. 质量目标

| 指标            | 目标值   | 测量方法                             |
| --------------- | -------- | ------------------------------------ |
| 打包体积（APK） | < 15MB   | 构建产物分析                         |
| 打包体积（IPA） | < 20MB   | 构建产物分析                         |
| 冷启动时间      | < 2秒    | Android Profiler / Xcode Instruments |
| 代码复用率      | > 90%    | 代码行数统计                         |
| 构建时间        | < 10分钟 | CI/CD流水线计时                      |
| 崩溃率          | < 0.1%   | Sentry监控                           |

## 🏛️ 架构设计

### 1. 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Lucky Nest Monorepo                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Frontend  │  │     API     │  │   Admin     │    │
│  │    Blog     │  │   (NestJS)  │  │   Panel     │    │
│  └──────┬──────┘  └─────────────┘  └─────────────┘    │
│         │                                              │
│  ┌──────▼──────────────────────────────────────┐      │
│  │           Next.js Build System               │      │
│  │  ┌────────────────────────────────────┐     │      │
│  │  │  Web Mode: output='standalone'     │     │      │
│  │  │  App Mode: output='export'         │     │      │
│  │  └──────────────┬─────────────────────┘     │      │
│  └─────────────────┼───────────────────────────┘      │
│                    │                                    │
│          ┌─────────▼─────────┐                        │
│          │   BUILD_TARGET    │                        │
│          │  Environment Var  │                        │
│          └─────────┬─────────┘                        │
│                    │                                    │
│          ┌─────────▼─────────┐  ┌──────────────────┐ │
│          │   Web Deployment   │  │  App Packaging   │ │
│          │  (Cloudflare/VPS)  │  │   (Capacitor)    │ │
│          └───────────────────┘  └─────────┬────────┘ │
│                                           │          │
│                                 ┌─────────▼─────────┐│
│                                 │   Native Wrapper  ││
│                                 │  Android  │  iOS  ││
│                                 └───────────┴───────┘│
└─────────────────────────────────────────────────────┘
```

### 2. 核心组件关系

```
+-------------------+       +-------------------+       +-------------------+
|   Next.js Source  |------>|   Build Pipeline  |------>|   Static Output   |
|   Code (TS/TSX)   |       |  (BUILD_TARGET)   |       |    (out folder)   |
+-------------------+       +-------------------+       +-------------------+
                                                                |
                                                                ▼
+-------------------+       +-------------------+       +-------------------+
|  Capacitor Config |<------|  Platform Sync    |<------|  Native Project   |
|  (capacitor.json) |       |  (cap sync)       |       |  (Android/iOS)    |
+-------------------+       +-------------------+       +-------------------+
                                                                |
                                                                ▼
+-------------------+       +-------------------+       +-------------------+
|   Code Signing    |------>|   Build Binary    |------>|  Distribution     |
|  (Keystore/Cert)  |       |  (APK/IPA/AAB)    |       |  (Store/OTA)      |
+-------------------+       +-------------------+       +-------------------+
```

### 3. 配置分层架构

```
┌─────────────────────────────────────────────────────┐
│                Environment Configuration            │
├─────────────────────────────────────────────────────┤
│ • BUILD_TARGET=app|web                              │
│ • NEXT_PUBLIC_APP_MODE=hybrid|web                   │
│ • CAPACITOR_ENV=dev|staging|prod                    │
└─────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────┐
│                Next.js Build Configuration          │
├─────────────────────────────────────────────────────┤
│ • next.config.ts: output模式切换                    │
│ • package.json: 构建脚本定义                        │
│ • env.*: 环境变量文件                               │
└─────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────┐
│                Capacitor Configuration              │
├─────────────────────────────────────────────────────┤
│ • capacitor.config.json: 应用元数据                 │
│ • android/: Gradle配置, Manifest                   │
│ • ios/: Xcode配置, Info.plist                      │
│ • plugins/: 原生插件配置                            │
└─────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────┐
│                Platform-specific Config             │
├─────────────────────────────────────────────────────┤
│ • Android: build.gradle, keystore.properties       │
│ • iOS: entitlements, provisioning profiles         │
│ • CI/CD: GitHub Actions, Fastlane                  │
└─────────────────────────────────────────────────────┘
```

## 📁 文件结构设计

### 1. 核心文件布局

```
apps/frontend-blog/
├── capacitor.config.json              # Capacitor主配置
├── capacitor.ci.json                  # CI/CD专用配置
├── android/                           # Android原生项目
│   ├── app/
│   │   ├── build.gradle
│   │   ├── src/main/
│   │   └── keystore.properties
│   └── variables.gradle
├── ios/                               # iOS原生项目
│   ├── App/
│   │   ├── App.xcodeproj
│   │   └── Info.plist
│   └── Podfile
├── scripts/
│   ├── capacitor/                     # Capacitor相关脚本
│   │   ├── init-app.sh
│   │   ├── build-android.sh
│   │   └── build-ios.sh
│   └── fastlane/                      # 自动化部署脚本
│       ├── Fastfile
│       └── Appfile
├── src/
│   ├── lib/
│   │   └── capacitor/                 # Capacitor工具函数
│   │       ├── bridge.ts              # Web-Native桥接
│   │       ├── plugins/               # 插件封装
│   │       └── env.ts                 # 环境检测
│   └── types/
│       └── capacitor.d.ts             # 类型声明（现有）
└── .github/
    └── workflows/
        ├── build-android.yml
        └── build-ios.yml
```

### 2. 配置文件详细设计

#### capacitor.config.json

```json
{
  "appId": "com.joyminis.blog",
  "appName": "JoyMinis Blog",
  "webDir": "out",
  "bundledWebRuntime": false,
  "server": {
    "url": "http://localhost:3000",
    "cleartext": true
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 2000,
      "launchAutoHide": true,
      "backgroundColor": "#ffffff",
      "androidSplashResourceName": "splash",
      "androidScaleType": "CENTER_CROP",
      "showSpinner": false,
      "androidSpinnerStyle": "large",
      "iosSpinnerStyle": "small",
      "spinnerColor": "#3b82f6",
      "splashFullScreen": true,
      "splashImmersive": true
    },
    "Preferences": {
      "group": "com.joyminis.blog"
    },
    "Keyboard": {
      "resize": "body",
      "style": "dark"
    },
    "StatusBar": {
      "backgroundColor": "#3b82f6",
      "style": "dark"
    },
    "PushNotifications": {
      "presentationOptions": ["badge", "sound", "alert"]
    }
  },
  "android": {
    "minWebViewVersion": 113,
    "allowMixedContent": true,
    "webContentsDebuggingEnabled": true
  },
  "ios": {
    "minVersion": "13.0",
    "preferredContentMode": "mobile",
    "scheme": "joyminisblog"
  }
}
```

#### 环境变量配置（.env.app）

```bash
# apps/frontend-blog/.env.app
BUILD_TARGET=app
NEXT_PUBLIC_APP_MODE=hybrid
NEXT_PUBLIC_CAPACITOR=true
NEXT_PUBLIC_ANDROID_PACKAGE=com.joyminis.blog
NEXT_PUBLIC_IOS_BUNDLE=com.joyminis.blog
NEXT_PUBLIC_VERSION=1.0.0
NEXT_PUBLIC_BUILD_NUMBER=1
```

#### Next.js配置更新（next.config.ts）

```typescript
// 关键配置部分
const nextConfig: NextConfig = {
  // 平台感知的输出配置
  // App构建使用静态导出，自动忽略ISR配置
  // Web构建使用独立部署，支持ISR/SSG
  output: process.env.BUILD_TARGET === "app" ? "export" : "standalone",

  // 其他配置保持不变...
};
```

## 🛠️ 实施指引

### 阶段1：基础配置（Week 1）

#### 任务清单

- [ ] 创建`capacitor.config.json`配置文件
- [ ] 扩展TypeScript类型声明（`src/types/capacitor.d.ts`）
- [ ] 更新`package.json`构建脚本
- [ ] 创建环境变量文件（`.env.app`）
- [ ] 验证Next.js App模式构建

#### 关键脚本

```json
// package.json scripts
{
  "scripts": {
    "build:app": "BUILD_TARGET=app next build",
    "cap:init": "npx cap init --web-dir out --app-id com.joyminis.blog --app-name \"JoyMinis Blog\"",
    "cap:add:android": "npx cap add android",
    "cap:add:ios": "npx cap add ios",
    "cap:sync": "npx cap sync",
    "cap:copy": "npx cap copy",
    "cap:update": "npx cap update",
    "cap:open:android": "npx cap open android",
    "cap:open:ios": "npx cap open ios",
    "app:init": "bash scripts/capacitor/init-app.sh",
    "app:build:android": "bash scripts/capacitor/build-android.sh",
    "app:build:ios": "bash scripts/capacitor/build-ios.sh"
  }
}
```

### 阶段2：原生平台集成（Week 2）

#### Android配置

- [ ] Gradle构建配置优化
- [ ] Keystore管理和代码签名配置
- [ ] 权限和特性配置（AndroidManifest.xml）
- [ ] 应用图标和启动图配置

#### iOS配置

- [ ] Xcode项目配置
- [ ] 证书和描述文件管理
- [ ] 权限和特性配置（Info.plist）
- [ ] 应用图标和启动图配置

#### 插件系统集成

- [ ] 核心插件：Preferences, Keyboard, StatusBar
- [ ] 业务插件：Camera, Geolocation, Biometric
- [ ] 自定义插件桥接实现

### 阶段3：开发体验优化（Week 3）

#### 热重载开发

- [ ] Capacitor Live Reload配置
- [ ] 开发服务器代理设置
- [ ] 远程调试支持

#### 类型安全增强

- [ ] Capacitor插件类型完整定义
- [ ] 平台特定API封装
- [ ] 错误处理标准化

#### 测试策略

- [ ] 单元测试：Web组件兼容性
- [ ] 集成测试：Web-Native桥接
- [ ] E2E测试：App流程验证

### 阶段4：部署自动化（Week 4）

#### CI/CD流水线

- [ ] GitHub Actions工作流配置
- [ ] 自动构建和签名流程
- [ ] 应用商店部署自动化

#### 监控和分析

- [ ] Sentry错误监控集成
- [ ] 性能指标收集
- [ ] 使用统计集成

## 📊 实施决策矩阵

### 构建策略选择

| 方案                     | 优点                 | 缺点                | 适用场景         | 推荐度 |
| ------------------------ | -------------------- | ------------------- | ---------------- | ------ |
| **静态导出 + Capacitor** | 代码复用高，构建简单 | 不支持SSR，功能受限 | 内容型应用，博客 | ★★★★★  |
| **混合渲染 + Capacitor** | SSR支持，SEO友好     | 构建复杂，包体积大  | 电商，需要SEO    | ★★★☆☆  |
| **原生渲染 + WebView**   | 性能最佳，原生体验   | 开发成本高，维护难  | 高性能应用，游戏 | ★★☆☆☆  |

### 插件集成策略

| 插件类型       | 集成方式             | 维护成本 | 推荐度 | 示例                   |
| -------------- | -------------------- | -------- | ------ | ---------------------- |
| **官方插件**   | 直接安装，类型安全   | 低       | ★★★★★  | @capacitor/preferences |
| **社区插件**   | 需要评估，可能需定制 | 中       | ★★★☆☆  | capacitor-blob-writer  |
| **自定义插件** | 完全控制，适配业务   | 高       | ★★☆☆☆  | 业务特定功能           |

### 部署策略对比

| 部署方式                      | 自动化程度   | 审核时间 | 适用阶段 | 工具                   |
| ----------------------------- | ------------ | -------- | -------- | ---------------------- |
| **应用商店**                  | 高，但需审核 | 1-7天    | 正式发布 | Google Play, App Store |
| **TestFlight**                | 中，需审核   | 1-2天    | 测试阶段 | Apple TestFlight       |
| **Firebase App Distribution** | 高，无需审核 | 即时     | 内测阶段 | Firebase Console       |
| **直接安装**                  | 低，手动操作 | 即时     | 开发调试 | ADB, Xcode             |

## 🔍 关键技术决策点

### 1. 构建模式决策

```typescript
// next.config.ts - 关键决策
export default {
  output: process.env.BUILD_TARGET === "app" ? "export" : "standalone",
  // App模式限制：
  // - 不能使用getServerSideProps（需改用getStaticProps或客户端获取）
  // - 不能使用API Routes（需独立后端服务）
  // - 需要纯静态或客户端渲染
  // - 路由需兼容静态导出
};
```

### 2. 环境检测策略

```typescript
// src/lib/capacitor/env.ts
export const isCapacitor = (): boolean => {
  // 方法1：环境变量检测（构建时）
  if (process.env.NEXT_PUBLIC_CAPACITOR === "true") return true;

  // 方法2：运行时特性检测（客户端）
  if (typeof window !== "undefined") {
    return "Capacitor" in window || "capacitor" in navigator;
  }

  return false;
};

export const getPlatform = (): "android" | "ios" | "web" => {
  if (!isCapacitor()) return "web";

  // Capacitor平台检测
  const platform = (window as any).Capacitor?.getPlatform();
  return platform || "web";
};

export const isNative = (): boolean => {
  return isCapacitor() && getPlatform() !== "web";
};
```

### 3. 数据持久化策略

```typescript
// src/lib/capacitor/storage.ts
export class HybridStorage {
  private static instance: HybridStorage;

  static getInstance(): HybridStorage {
    if (!HybridStorage.instance) {
      HybridStorage.instance = new HybridStorage();
    }
    return HybridStorage.instance;
  }

  async getItem(key: string): Promise<string | null> {
    if (isCapacitor()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        const result = await Preferences.get({ key });
        return result.value;
      } catch (error) {
        console.warn(
          "Capacitor Preferences failed, fallback to localStorage:",
          error,
        );
        return localStorage.getItem(key);
      }
    }
    return localStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    if (isCapacitor()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.set({ key, value });
        return;
      } catch (error) {
        console.warn(
          "Capacitor Preferences failed, fallback to localStorage:",
          error,
        );
      }
    }
    localStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (isCapacitor()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.remove({ key });
        return;
      } catch (error) {
        console.warn(
          "Capacitor Preferences failed, fallback to localStorage:",
          error,
        );
      }
    }
    localStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    if (isCapacitor()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.clear();
        return;
      } catch (error) {
        console.warn(
          "Capacitor Preferences failed, fallback to localStorage:",
          error,
        );
      }
    }
    localStorage.clear();
  }
}
```
