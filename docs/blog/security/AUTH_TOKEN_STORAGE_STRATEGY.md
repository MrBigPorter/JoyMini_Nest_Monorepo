# 认证Token跨平台存储策略 v2.0

> 📅 创建时间：2026-04-20 | 📅 最后更新：2026-04-20
> 🎯 目标：统一Web、App和服务器端的认证状态访问
> 📚 相关文档：
>
> - [Blog认证系统文档索引](./BLOG_AUTHENTICATION_INDEX.md) - 完整认证系统概述
> - [认证拦截四层防护架构](../../nextjs/AUTH_INTERCEPTION_ARCHITECTURE.md) - 认证拦截实现
> - [JWT认证与权限系统](./JWT_PERMISSION_IMPLEMENTATION.md) - 后端API保护

## 🎯 问题背景

### ❌ 当前问题

1. **存储不一致**：Token仅存储在localStorage中，中间件无法读取
2. **认证拦截失效**：Middleware依赖cookie检查，导致受保护路由可能被绕过
3. **跨平台兼容性差**：Web依赖cookie，App可能依赖不同存储机制
4. **安全漏洞**：服务端无法验证客户端认证状态

### 解决方案目标

- **统一存储策略**：所有平台使用相同认证数据流
- **服务器端可读**：认证状态必须对中间件可见
- **客户端兼容**：保持现有localStorage用于client-side状态管理
- **平台适配**：根据平台选择最优存储方案

## 🏛️ 三层存储架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Zustand Store │────▶│  Cookie (HTTP)  │────▶│ Middleware      │
│   (localStorage)│    │   (Server-Read) │    │  (Server-Side)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                        │                        │
        └───────────┬────────────┘                        │
                    │                                     │
            ┌───────▼───────┐                    ┌───────▼───────┐
            │   Platform    │                    │  App环境      │
            │   Adapter     │                    │  (Capacitor)  │
            │ (Capacitor)   │                    │               │
            └───────────────┘                    └───────────────┘
```

### 各层职责

#### 1. **Zustand Store层** (客户端状态管理)

- **存储位置**：localStorage (Web) / Capacitor Preferences (App)
- **职责**：客户端组件状态管理、UI渲染、API请求头
- **数据**：accessToken, refreshToken, user信息
- **特点**：快速访问、支持复杂状态、客户端专用

#### 2. **Cookie层** (服务器可读通道)

- **存储位置**：HTTP Cookie
- **职责**：中间件认证拦截、服务器端状态检查
- **数据**：accessToken (简化版本)
- **特点**：服务器可读、自动随请求发送、支持SSR

#### 3. **平台适配层** (跨平台兼容)

- **Web环境**：使用`document.cookie` API
- **App环境**：使用`@capacitor/preferences` + Cookie备用方案
- **职责**：统一存储接口、平台特性适配、降级处理

## 🔧 实施规范

### Web环境配置

```typescript
// Cookie属性配置
const cookieConfig = {
  name: "auth_token", // Cookie名称
  path: "/", // 作用路径
  maxAge: 86400, // 1天有效期（秒）
  sameSite: "lax" as const, // CSRF防护
  secure: process.env.NODE_ENV === "production", // 仅HTTPS
  httpOnly: false, // JavaScript可访问（需要客户端操作）
};
```

### App环境 (Capacitor) 配置

```typescript
// 双重存储策略
const appStorageConfig = {
  primary: "@capacitor/preferences", // 原生安全存储
  fallback: "cookie", // 兼容中间件
  syncStrategy: "write-through", // 写入时同步
};
```

### 安全配置矩阵

| 属性         | Web环境  | App环境  | 说明                       |
| ------------ | -------- | -------- | -------------------------- |
| **HttpOnly** | ❌ 禁用  | ❌ 禁用  | 需要JavaScript访问进行同步 |
| **Secure**   | 生产环境 | 总是     | 防止明文传输               |
| **SameSite** | Lax      | Lax      | CSRF防护                   |
| **Max-Age**  | 86400秒  | 86400秒  | 1天有效期                  |
| **Domain**   | 当前域名 | 当前域名 | 不跨域                     |

## 📋 同步机制

### 登录时同步流程

```
1. API返回tokens
2. Zustand Store更新 (localStorage)
3. 触发Cookie同步 (document.cookie)
4. App环境：同时写入Capacitor Preferences
5. 完成：所有存储层一致
```

### 登出时同步流程

```
1. 用户触发登出
2. Zustand Store清除
3. Cookie清除 (max-age=0)
4. App环境：清除Capacitor Preferences
5. 完成：所有存储层清除
```

### Token刷新同步

```
1. 刷新API返回新tokens
2. Zustand Store更新
3. Cookie更新为新token
4. 保持用户会话连续性
```

## 🚀 实施路线图

### 阶段一：核心同步机制 (立即)

1.  修改`auth.store.ts`，在登录/登出时同步设置/清除cookie
2.  增强`cookie-manager.ts`，添加平台感知的cookie操作
3.  更新`useAuth` hook，确保cookie操作在客户端环境执行

### 阶段二：平台适配优化 (1天)

4. 🔄 为Capacitor环境创建专用cookie适配器
5. 🔄 测试Web和App环境下的认证流程
6. 🔄 验证中间件拦截功能

### 阶段三：验证与测试 (1天)

7. 🔄 运行类型检查和lint验证
8. 🔄 测试认证流程完整性
9. 🔄 更新架构文档

### 阶段四：文档与知识传递 (1天)

10. 🔄 更新所有相关技术文档
11. 🔄 创建开发者指南
12. 🔄 团队培训材料

## ⚠️ 边界情况处理

### 1. 存储不一致恢复

```typescript
// 启动时检查并修复不一致
function checkAndFixStorageConsistency() {
  const localStorageToken = localStorage.getItem("auth_token");
  const cookieToken = getCookie("auth_token");

  if (localStorageToken && !cookieToken) {
    // localStorage有但cookie没有：同步到cookie
    setCookie("auth_token", localStorageToken);
  } else if (!localStorageToken && cookieToken) {
    // cookie有但localStorage没有：同步到localStorage
    localStorage.setItem("auth_token", cookieToken);
  }
}
```

### 2. 平台检测与降级

```typescript
// 平台感知的存储操作
function setAuthToken(token: string) {
  if (isWebEnvironment()) {
    // Web: localStorage + cookie
    localStorage.setItem("auth_token", token);
    document.cookie = `auth_token=${token}; path=/; max-age=86400; SameSite=Lax`;
  } else if (isCapacitorApp()) {
    // App: Capacitor Preferences + cookie备用
    Preferences.set({ key: "auth_token", value: token });
    // 同时设置cookie兼容中间件
    document.cookie = `auth_token=${token}; path=/; max-age=86400; SameSite=Lax`;
  }
}
```

### 3. 迁移策略

- **渐进式迁移**：先启用cookie同步，再逐步验证
- **向后兼容**：现有localStorage数据继续工作
- **监控告警**：记录存储不一致事件

## 📊 成功指标

### 技术指标

- Middleware能正确拦截未认证请求
- 所有存储层保持同步
- 无认证状态不一致导致的UI闪烁
- ✅ 跨平台认证体验一致

### 用户体验指标

- ✅ 受保护路由零闪烁跳转
- ✅ 登录状态持久化
- ✅ 平台切换无感知
- ✅ 安全无降级

## 📁 文件结构变更

```
apps/frontend-blog/src/
├── lib/
│   ├── stores/
│   │   └── auth.store.ts           # 修改：添加cookie同步
│   ├── utils/
│   │   └── cookie-manager.ts       # 增强：平台适配
│   ├── platform/
│   │   └── adapters/
│   │       └── storage.adapter.ts  # 新增：统一存储适配器
│   └── hooks/
│       └── useAuth.ts              # 修改：确保客户端执行
├── middleware.ts                    # 不变：依赖cookie检查
└── docs/
    └── AUTH_TOKEN_STORAGE_STRATEGY.md  # 新增：本文档
```

## 🔄 版本历史

### v2.0 (2026-04-20) - 单一Cookie存储架构

- **架构简化**：从双重存储(localStorage + Cookie)简化为单一Cookie存储
- **统一策略**：与语言设置保持一致的存储策略，完全使用Cookie
- **技术实现**：
  - 创建`cookie-storage.ts`适配器，实现Zustand StateStorage接口
  - 修改`auth.store.ts`使用Cookie存储适配器
  - 清理`cookie-manager.ts`中的localStorage冗余逻辑
- **兼容性**：保持向后兼容，支持Capacitor App环境
- **优势**：
  - 存储机制统一，减少维护复杂度
  - 服务器端可读，中间件认证拦截有效
  - 跨平台一致，Web和App使用相同存储策略

### v1.0 (2026-04-20)

- **初始版本**：三层存储架构设计
- **包含**：Web/App平台适配方案
- **包含**：同步机制和边界处理
- **包含**：实施路线图和成功指标

---

> 💡 **架构原则**：认证状态应该在所有可访问的存储层中保持一致，确保服务器端和客户端有统一的视图。

> 🔒 **安全原则**：在方便性和安全性之间找到平衡，既要支持跨平台访问，又要防止常见攻击。

> 🌐 **兼容性原则**：新架构应该向后兼容，平滑迁移，不影响现有用户体验。
