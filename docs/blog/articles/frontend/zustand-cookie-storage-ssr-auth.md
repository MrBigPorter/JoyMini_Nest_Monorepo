# Zustand + Cookie Storage — SSR 认证持久化策略

> **源码**: [`auth.store.ts`](apps/frontend-blog/src/lib/stores/auth.store.ts) (357L) · [`cookie-storage.ts`](apps/frontend-blog/src/lib/stores/cookie-storage.ts) (171L) · [`cookie-manager.ts`](apps/frontend-blog/src/lib/utils/cookie-manager.ts)

## 问题

Next.js 中 Zustand 的 `persist` 中间件默认使用 `localStorage`，这在 SSR 环境下不可用。标准做法是用 `createJSONStorage(() => localStorage)` + `partialize` + `ssr` 选项，但这种方式依赖异步水合（hydration），导致：

1. **Flicker 问题** — 页面先渲染未登录状态，水合完成后突然切换为已登录
2. **Middleware 无法读取** — `middleware.ts` 无法 await Zustand 异步水合
3. **多 Tab 不同步** — 同一浏览器多标签页登录/登出不感知

## 方案：Cookie Storage 适配器 + 同步读取 + 双缓冲

核心思路：用 Cookie 替代 `localStorage` 作为 Zustand 持久化后端，利用 Cookie 的 SSR 兼容性实现**同步读取**。

### 1. 自定义 `StateStorage` 适配器

[`cookieStorage`](apps/frontend-blog/src/lib/stores/cookie-storage.ts:17) 实现 Zustand 的 `StateStorage` 接口：

```ts
export const cookieStorage: StateStorage = {
  getItem: (name: string): string | null => {
    if (typeof document === 'undefined') return null;
    
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    if (!match) return null;

    const cookieValue = decodeURIComponent(match[2]);

    // 检查是否已是 JSON 格式（Zustand 存储格式）
    try {
      const parsed = JSON.parse(cookieValue);
      if (parsed && typeof parsed === 'object') return cookieValue;
    } catch {
      // 旧格式：单独的 token cookie
      const tokenValue = getTokenCookie();
      if (tokenValue) {
        return JSON.stringify({
          state: { accessToken: tokenValue, refreshToken: null, user: null },
          version: 0,
        });
      }
    }
    return cookieValue;
  },

  setItem: (name: string, value: string): void => {
    // 解析 Zustand 数据 → 写入完整状态 Cookie + 单独的 accessToken Cookie
    const parsed = JSON.parse(value);
    const accessToken = parsed?.state?.accessToken;
    if (accessToken) {
      document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=86400; SameSite=Lax${secureFlag}`;
      setTokenCookie(accessToken); // 向后兼容
    } else {
      // 登出：清除所有 Cookie
      document.cookie = `${name}=; path=/; max-age=0`;
      clearTokenCookie();
    }
  },

  removeItem: (name: string): void => {
    document.cookie = `${name}=; path=/; max-age=0`;
    clearTokenCookie();
  },
};
```

关键设计决策：
- **双 Cookie 策略** — 同时写入完整 Zustand 状态（`auth-storage=...`）和单独的 `accessToken` Cookie（向后兼容 middleware 直接读取）
- **旧格式兼容** — `getItem` 捕获 JSON 解析错误，回退到 `getTokenCookie()` 读取旧 token
- **SSR 安全** — 所有方法都有 `typeof document === 'undefined'` 守卫

### 2. Store 配置：`persist` + `cookieStorage`

[`auth.store.ts`](apps/frontend-blog/src/lib/stores/auth.store.ts:90) 使用 Zustand `persist` 中间件：

```ts
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      isHydrated: false,
      _synced: false,

      login: (tokens, user) => {
        set({ ...tokens, user, isHydrated: true, _synced: true });
        setTokenCookie(tokens.accessToken); // 同步写入 Cookie
      },

      logout: () => {
        clearTokenCookie();
        set({ user: null, accessToken: null, refreshToken: null, _synced: true });
      },

      syncFromStorage: () => {
        if (typeof window === 'undefined') return;
        if (get()._synced) return; // 防止重复同步

        const raw = cookieStorage.getItem('auth-storage');
        if (raw instanceof Promise) {
          raw.then((data) => {
            if (!data) { set({ _synced: true }); return; }
            const parsed = JSON.parse(data);
            set({
              accessToken: parsed.state?.accessToken || null,
              refreshToken: parsed.state?.refreshToken || null,
              user: parsed.state?.user || null,
              _synced: true,
            });
          });
        } else if (raw) {
          const parsed = JSON.parse(raw);
          set({
            accessToken: parsed.state?.accessToken || null,
            refreshToken: parsed.state?.refreshToken || null,
            user: parsed.state?.user || null,
            _synced: true,
          });
        }
      },

      isAuthenticated: () => !!(get().accessToken && get().user),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => cookieStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
      migrate: migrateAuthState,
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
        if (state) state._synced = true;
      },
    },
  ),
);
```

### 3. 同步读取 + 双缓冲模式

这是解决 SSR 水合 flicker 的核心技巧：

#### 3.1 `_synced` 双缓冲标志

store 中有一个 `_synced: boolean` 字段，作为**同步状态标志**。它在两个地方被设置：

1. **`syncFromStorage()`** 方法 — 在客户端初始化时立即同步读取 Cookie
2. **`onRehydrateStorage`** 回调 — Zustand 异步水合完成后

```ts
// 客户端初始化时立即同步读取
if (typeof window !== 'undefined') {
  if (supportsSyncRead()) {
    useAuthStore.getState().syncFromStorage(); // 同步读取 Cookie
  }

  // 兜底：延迟设置水合完成
  setTimeout(() => {
    const state = useAuthStore.getState();
    if (!state.isHydrated) state.setHydrated();
    if (!state._synced) state._synced = true;
  }, 0);
}
```

执行顺序：
```
1. 服务端渲染 → isHydrated: false, accessToken: null
2. 客户端 hydrate → SSR 水合，组件挂载
3. syncFromStorage() 同步读取 Cookie → 立即设置 accessToken ✅
4. Zustand 异步 onRehydrateStorage → 第二次同步（幂等）
```

#### 3.2 迁移函数：旧格式兼容

```ts
const migrateAuthState = (persistedState: any): Partial<AuthState> => {
  if (persistedState && 'accessToken' in persistedState) return persistedState; // 新格式
  if (persistedState?.state) return persistedState.state; // 旧格式（state 包裹）
  return { user: null, accessToken: null, refreshToken: null }; // 空数据
};
```

三种格式兼容：
| 格式 | 结构 | 来源 |
|------|------|------|
| 新格式 | `{ accessToken, refreshToken, user }` | Zustand persist v4+ |
| 旧格式 | `{ state: { accessToken, refreshToken, user } }` | Zustand persist v3 |
| 无数据 | `null / undefined` | 首次访问/登出 |

### 4. 简化读取：`getAuthStateFromCookie`

用于 middleware 或 server component 快速读取，不依赖 Zustand：

```ts
export const getAuthStateFromCookie = (): {
  accessToken: string | null;
  isAuthenticated: boolean;
} => {
  const token = getTokenCookie();
  return {
    accessToken: token,
    isAuthenticated: !!token,
  };
};
```

Middleware 使用示例：
```ts
// middleware.ts
import { getAuthStateFromCookie } from '@/lib/stores/cookie-storage';

export function middleware(request: NextRequest) {
  const { isAuthenticated } = getAuthStateFromCookie();
  
  if (!isAuthenticated && request.nextUrl.pathname.startsWith('/me')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
```

## 架构决策与权衡

### 为什么选择 Cookie 而非 localStorage？

| 维度 | Cookie | localStorage |
|------|--------|-------------|
| SSR 读取 | ✅ Document.cookie 在服务端不可用，但 middleware 可读取 | ❌ 服务端完全不可用 |
| 大小限制 | ~4KB（足以存 token + user 元数据） | ~5MB |
| CSRF 风险 | 需设置 `SameSite=Lax` + 无 `HttpOnly`（JS 需要读取） | 仅 JS 可访问 |
| 多 Tab 同步 | ✅ 天然同域共享 | ❌ 需要 `storage` 事件监听 |
| 带宽 | 每次请求自动携带 | 不自动发送 |

### 为什么保留 `isHydrated` 和 `_synced` 两个标志？

- **`isHydrated`** — Zustand 标准水合状态，用于组件等待水合完成
- **`_synced`** — 自定义同步状态，指示 `syncFromStorage()` 已完成同步读取

```tsx
// 组件中使用
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isHydrated, _synced } = useAuthStore();
  
  // 等待同步或水合完成
  if (!isHydrated && !_synced) {
    return <LoadingSkeleton />; // SSR 安全占位
  }

  if (!isAuthenticated()) {
    return <Redirect to="/login" />;
  }

  return children;
}
```

## 时序图

```
Browser                     Zustand                    Cookie Storage              Middleware
  │                           │                            │                         │
  ├── SSR Render ─────────────┤                            │                         │
  │                           ├── isHydrated: false        │                         │
  │                           ├── accessToken: null        │                         ├── reads cookie
  │                           │                            │                         ├── isAuthenticated?
  │                           │                            │                         │
  ├── Client Hydrate ─────────┤                            │                         │
  │                           │                            │                         │
  ├── syncFromStorage() ──────┤                            │                         │
  │                           ├── cookieStorage.getItem() ──┤                         │
  │                           │                            ├── parse cookie           │
  │                           │◄── state + token ──────────┤                         │
  │                           ├── set({ accessToken, ... })│                         │
  │                           ├── isAuthenticated: true    │                         │
  │                           │                            │                         │
  ├── onRehydrateStorage() ───┤                            │                         │
  │                           ├── _synced: true (再确认)    │                         │
  │                           ├── isHydrated: true         │                         │
  │                           │                            │                         │
  └── UI re-render ──────────► 组件读取最新状态              │                         │
```

## 与 Flutter 方案的对比

| 特性 | Next.js (Zustand + Cookie) | Flutter (HydratedStateNotifier) |
|------|---------------------------|--------------------------------|
| 存储后端 | Cookie (4KB) | SharedPreferences (无大小限制) |
| SSR 兼容 | ✅ Cookie 天然支持 | N/A (Flutter 无 SSR) |
| 同步读取 | ✅ `syncFromStorage()` | ❌ 构造器异步 `_load()` |
| 迁移策略 | ✅ `migrate` 函数 | ❌ 无内置迁移，需手动处理 |
| 平台适配 | 仅 Web | iOS/Android/Web 三端 |
| 多 Tab 同步 | ✅ 自动 | N/A (单实例) |

## 总结

Zustand + Cookie Storage 模式的核心价值不在于 Cookie 本身，而在于它**打破了异步水合的时序依赖**。通过 `syncFromStorage()` 同步读取 + `_synced` 双缓冲标志，实现了：

1. **零 flicker** — 客户端初始化时同步读取 Cookie，比异步水合快一个 tick
2. **Middleware 可直接读取** — `getAuthStateFromCookie()` 简化读取不依赖 Zustand
3. **向后兼容** — `migrateAuthState` 处理三种存储格式，`setItem` 维护双 Cookie 结构
4. **SSR 安全** — 所有浏览器 API 都有 `typeof window === 'undefined'` 守卫
