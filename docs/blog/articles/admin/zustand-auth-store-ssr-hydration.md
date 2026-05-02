# Zustand 认证存储 + SSR Hydration — 管理后台三 Store 架构

> **难度**: ⭐⭐⭐⭐  
> **适用场景**: 任何需要客户端状态管理 + SSR 兼容的 Next.js 应用  
> **源码位置**: 
> - [`useAuthStore.ts`](../../../../apps/admin-next/src/store/useAuthStore.ts)
> - [`useAppStore.ts`](../../../../apps/admin-next/src/store/useAppStore.ts)
> - [`useToastStore.ts`](../../../../apps/admin-next/src/store/useToastStore.ts)

## 一、为什么需要专门的状态管理？

管理后台有**三类状态**，每一类对持久化的需求不同：

| Store | 状态 | 持久化 | SSR 安全 | 跨 tab 同步 |
|-------|------|--------|---------|------------|
| `useAuthStore` | token, userInfo, role | ✅ localStorage | ✅ typeof window 守卫 | 不需要（一个 tab 登录即可） |
| `useAppStore` | theme, lang, sidebar | ✅ Zustand persist | ✅ SSR 空实现 | 不需要 |
| `useToastStore` | toast messages | ❌ 内存 | ✅ 天然安全 | 不需要 |

**为什么不用 Redux？** Zustand 的三大优势：

1. **无 Provider** — 直接 `useAuthStore()` 调用，不需包裹 `<Provider>`
2. **轻量** — 三个 store 合计不到 300 行
3. **SSR 友好** — 通过 `typeof window` 守卫 + `persist` middleware 的 SSR 空实现

## 二、useAuthStore — 认证状态的核心

### 2.1 Store 结构

[`useAuthStore.ts`](../../../../apps/admin-next/src/store/useAuthStore.ts) 定义了 6 个状态 + 6 个操作：

```ts
interface AuthState {
  // 状态
  isAuthenticated: boolean;
  userRole: UserRole;       // 'admin' | 'editor' | 'viewer'
  token: string | null;
  refreshToken: string | null;
  userInfo: AdminUser | null;

  // 操作
  login: (token, role?, userInfo?, refreshToken?) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => void;
  setTokens: (token, refreshToken?) => void;
  fetchMe: () => Promise<void>;
}
```

### 2.2 登录流程 — 三阶段同步

```
用户提交表单
    │
    ▼
authApi.login(username, password)
    │
    ▼
后端返回 { tokens: { accessToken, refreshToken }, userInfo }
    │
    ▼
┌──────────────────────────────────────────────┐
│  useAuthStore.login()                         │
│  1. localStorage.setItem('auth_token', token)  │  ← 立即写入客户端
│  2. localStorage.setItem('refresh_token', ...) │
│  3. authApi.setCookie(token)                  │  ← 异步设置 httpOnly cookie
│     └─ 失败时 console.warn，不阻塞登录          │
│  4. set({ isAuthenticated: true, token, ... }) │  ← 更新 Zustand 状态
└──────────────────────────────────────────────┘
    │
    ▼
window.location.replace('/')  →  浏览器跳转
```

**为什么要先写 localStorage 再 setCookie？**

1. `localStorage.setItem` 是同步的，写入后 `checkAuth()` 立即读到
2. `authApi.setCookie` 是异步 HTTP 请求，如果先 setCookie 再写 localStorage，在极端网络情况下用户可能看到「闪一下未登录状态」
3. Cookie 设置失败不阻塞登录——`console.warn` 降级，Middleware 下次校验时 cookie 不存在会重定向到 `/login`，但 `checkAuth()` 从 localStorage 恢复

### 2.3 退出流程 — Promise.allSettled 三路清理

```ts
logout: async () => {
  const results = await Promise.allSettled([
    authApi.logout(),       // 1. 后端清除 refresh token
    authApi.clearCookie(),  // 2. 后端清除 httpOnly cookie
  ]);
  // 记录失败但不阻止
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[useAuthStore] API call ${index === 0 ? 'logout' : 'clearCookie'} failed:`, result.reason);
    }
  });
  // 3. 无论如何都清理本地存储
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('csrf_token');
  set({ isAuthenticated: false, token: null, userRole: 'viewer', userInfo: null });
  window.location.replace('/login');  // 使用 replace 避免历史记录问题
};
```

**为什么用 `Promise.allSettled` 而不是 `Promise.all`？**

因为即使 `logout()` API 调用失败（网络超时、服务器 500），用户也应该能退出。`allSettled` 确保：
- 两个 API 独立执行，一个失败不影响另一个
- `finally` 块无条件清理本地存储

### 2.4 checkAuth — 页面刷新恢复

每次页面刷新，Zustand 状态丢失（内存中），需要从 `localStorage` 恢复：

```ts
checkAuth: () => {
  const token = localStorage.getItem('auth_token');
  const refreshToken = localStorage.getItem('refresh_token');
  if (token) {
    set({
      isAuthenticated: true,
      token,
      refreshToken,
      userRole: 'admin',  // 默认角色，fetchMe 会覆盖
    });
  } else {
    set({
      isAuthenticated: false,
      token: null,
      refreshToken: null,
      userRole: 'viewer',
    });
  }
},
```

这个函数通常在 **`useEffect`** 或 **`useLayoutEffect`** 中调用（因为需要 `window` 对象）。

### 2.5 fetchMe — 服务端用户信息同步

`setTokens` 设置了 token 但 `userInfo`（用户名、头像等）需要从后端获取：

```ts
fetchMe: async () => {
  const token = localStorage.getItem('auth_token');
  if (!token) return;
  try {
    const userInfo = await authApi.getMe();
    set({
      userInfo,
      userRole: (userInfo.role as UserRole) ?? 'admin',
      isAuthenticated: true,
    });
  } catch {
    // token 过期或无效由 HTTP 拦截器处理，这里静默忽略
  }
},
```

**静默忽略策略**：如果 `getMe()` 返回 401，HttpClient 的拦截器会触发 refresh + retry，不需要在这里处理。

## 三、useAppStore — 持久化 + SSR 安全

### 3.1 persist middleware

[`useAppStore`](../../../../apps/admin-next/src/store/useAppStore.ts) 使用 Zustand 的 `persist` middleware 将 theme、lang、sidebar 状态持久化到 `localStorage`：

```ts
export const useAppStore = create<AppState>()(
  persist<AppState>(
    (set) => ({
      theme: 'dark',
      lang: DEFAULT_LOCALE,
      isSidebarCollapsed: false,
      // ... actions
    }),
    {
      name: 'app-store',   // localStorage key
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return {            // SSR 空实现
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      partialize: (state) => ({   // 只持久化需要的字段
        theme: state.theme,
        lang: state.lang,
        isSidebarCollapsed: state.isSidebarCollapsed,
      }) as unknown as AppState,
    },
  ),
);
```

### 3.2 SSR 安全三件套

| 机制 | 代码 | 作用 |
|------|------|------|
| `typeof window === 'undefined'` | 判断 SSR 环境 | 避免 ReferenceError: window is not defined |
| 空实现 storage | `getItem: () => null` | SSR 期间不读写 localStorage |
| `partialize` | 只持久化 theme/lang/sidebar | 避免将函数（setState）序列化到 localStorage |

### 3.3 主题切换

`toggleTheme` 函数不仅在 Zustand 中更新状态，还同步修改 DOM：

```ts
toggleTheme: () => set((state) => {
  const newTheme = state.theme === 'dark' ? 'light' : 'dark';
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(newTheme);
  }
  return { theme: newTheme };
}),
```

**为什么在 store 里直接操作 DOM？** 因为主题需要**立即生效**——如果只改 Zustand 状态，UI 需要等到下一次渲染才能反映变化，会导致「闪白」或「闪黑」。

## 四、useToastStore — 轻量事件广播

[`useToastStore`](../../../../apps/admin-next/src/store/useToastStore.ts) 是最简单的 store，只有 27 行，实现了一个**去重队列**：

```ts
addToast: (type, message) => {
  set((state) => {
    const exists = state.toasts.some(
      (t) => t.type === type && t.message === message,
    );
    if (exists) return state;  // 去重：相同 type+message 不重复
    const id = Date.now().toString();
    return { toasts: [...state.toasts, { id, type, message }] };
  });
},
```

HttpClient 中通过 `getState()` 直接调用（不经过 React 组件）：

```ts
import { useToastStore } from '@/store/useToastStore';

// 在拦截器中
useToastStore.getState().addToast('error', message);
```

**关键模式**：Zustand 的 `getState()` 让**非组件代码**（拦截器、工具函数）也能安全地更改 store 状态。

## 五、SSR Hydration 策略对比

### 5.1 三种 Store 的 Hydration 策略

| Store | SSR 期间值 | 客户端恢复 | Hydration Mismatch 风险 |
|-------|-----------|-----------|----------------------|
| `useAuthStore` | 默认值（未认证） | `checkAuth()` 从 localStorage | 低 — token 在 SSR 时不可用 |
| `useAppStore` | 默认值（dark/zh） | `persist` 自动从 localStorage 恢复 | 中 — theme 初始值可能和持久化不一致 |
| `useToastStore` | 初始值（空数组） | 无需恢复 | 无 |

### 5.2 与 Frontend Blog 的对比

| 维度 | Frontend Blog | Admin Next |
|------|--------------|------------|
| 认证存储 | Zustand + Cookie Storage SSR Plugin | Zustand + localStorage + httpOnly cookie |
| 持久化 | `zustand-persist` + `zustand-cookie-storage` | `zustand/middleware` + `createJSONStorage` |
| SSR 安全 | Cookie Storage 天然支持 SSR | `typeof window` 守卫 |
| 主题切换 | CSS 变量 + Tailwind dark class | 同上 |
| Store 数量 | 2 (auth, app) | 3 (auth, app, toast) |
| Token 刷新 | HTTP-only cookie，客户端无需存 refresh token | localStorage + 单飞 refresh |

**关键差异**：Frontend Blog 使用 **httpOnly cookie** 存 token（SSR 时自动携带），而 Admin Next 使用 **localStorage + Cookie 双写**（Middleware 需要读取 cookie 做服务端校验）。

## 六、完整认证流

```
┌────────────────────────────────────────────────────────────┐
│                    首次登录                                 │
│                                                            │
│  LoginForm                                                    │
│    ↓ POST /auth/login                                        │
│  API → { tokens, userInfo }                                  │
│    ↓                                                         │
│  useAuthStore.login(token, role, userInfo, refreshToken)     │
│    ├─ localStorage.setItem('auth_token', token)              │
│    ├─ authApi.setCookie(token)    ← 异步设置 httpOnly cookie │
│    └─ set({ isAuthenticated: true, ... })                    │
│    ↓                                                         │
│  window.location.replace('/')                                │
│    ↓                                                         │
│  ┌─────────────────────────────────────────┐                │
│  │ Middleware: 读取 cookie → JWT decoded    │                │
│  │ token 有效 → NextResponse.next()        │                │
│  └─────────────────────────────────────────┘                │
│    ↓                                                         │
│  Page Component                                              │
│    ↓                                                         │
│  useAuthStore.getState().checkAuth()   ← 从 localStorage 恢复│
│  useAuthStore.getState().fetchMe()     ← 获取 userInfo       │
│    ↓                                                         │
│  → 页面正常渲染                                               │
└────────────────────────────────────────────────────────────┘
```

## 七、最佳实践总结

### 7.1 Store 拆分原则

| 场景 | 应创建独立 Store | 理由 |
|------|-----------------|------|
| 不同持久化策略 | ✅ 是 | auth → localStorage, toast → 内存 |
| 不同更新频率 | ✅ 是 | auth 低频，toast 高频 |
| 跨组件复用 | ✅ 是 | 避免 props drilling |
| 单元测试 | ✅ 是 | 每个 store 独立测试，不互相影响 |

### 7.2 SSR 安全 Checklist

- [ ] `typeof window === 'undefined'` 守卫所有 `localStorage`/`sessionStorage` 调用
- [ ] Zustand `persist` 的 `storage` 参数提供 SSR 空实现
- [ ] `partialize` 排除函数和大型对象
- [ ] `checkAuth()` 在 `useEffect` 中调用，不在 render 阶段
- [ ] 主题切换直接操作 DOM，避免 hydration 闪白

### 7.3 错误恢复

```
Middleware 检测 cookie 过期
    → 清理 cookie + 302 /login
    → Login 页面
    → useAuthStore.checkAuth() 从 localStorage 恢复
    → 如果 localStorage 也有过期 token（极少发生）
    → HttpClient 401 → refreshAccessToken → 失败 → handleUnauthorized → 清理 + /login
```

**三层兜底确保用户永远能在 token 过期后正常退出并重新登录。**

---

**相关阅读**：

- [A5: Middleware JWT 路由守卫 — Edge Runtime 下的认证防线](./middleware-jwt-route-guard.md) — 服务端认证
- [A4: HttpClient 请求层 — 双环境配置 + 单飞 Token 刷新](./http-client-auth-refresh-retry.md) — 401 拦截
- [F3: 三模式 Fetcher 适配层](../frontend/nextjs-universal-fetcher.md) — Frontend Blog 的请求架构对比
