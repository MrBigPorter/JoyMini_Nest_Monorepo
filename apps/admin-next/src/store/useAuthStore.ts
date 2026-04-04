import { create } from 'zustand';
import { UserRole, AdminUser } from '@/type/types';
import { authApi } from '@/api';

interface AuthState {
  isAuthenticated: boolean;
  userRole: UserRole;
  token: string | null;
  refreshToken: string | null;
  userInfo: AdminUser | null;
  login: (
    token: string,
    role?: UserRole,
    userInfo?: AdminUser,
    refreshToken?: string | null,
  ) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => void;
  setTokens: (token: string, refreshToken?: string | null) => void;
  /** page refresh 后调用，从后端拉取最新 userInfo 并写入 store */
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  userRole: 'viewer',
  token: null,
  refreshToken: null,
  userInfo: null,

  login: async (token, role = 'admin', userInfo, refreshToken = null) => {
    localStorage.setItem('auth_token', token);
    if (refreshToken) {
      localStorage.setItem('refresh_token', refreshToken);
    } else {
      localStorage.removeItem('refresh_token');
    }
    try {
      await authApi.setCookie(token);
    } catch (e) {
      console.warn(
        '[useAuthStore] set-cookie failed, fallback to localStorage only',
        e,
      );
    }
    set({
      isAuthenticated: true,
      token,
      refreshToken,
      userRole: role,
      userInfo: userInfo ?? null,
    });
  },

  setTokens: (token, refreshToken = null) => {
    localStorage.setItem('auth_token', token);
    if (refreshToken) {
      localStorage.setItem('refresh_token', refreshToken);
    }
    set((state) => ({
      token,
      refreshToken: refreshToken ?? state.refreshToken,
      isAuthenticated: true,
    }));
  },

  logout: async () => {
    try {
      // 使用Promise.allSettled确保即使某些请求失败也能继续执行
      const results = await Promise.allSettled([
        authApi.logout(),
        authApi.clearCookie(),
      ]);

      // 记录任何失败但不阻止退出登录流程
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(
            `[useAuthStore] logout API call ${index === 0 ? 'logout' : 'clearCookie'} failed:`,
            result.reason,
          );
        }
      });
    } catch (error) {
      console.error('[useAuthStore] logout unexpected error', error);
    } finally {
      // 无论如何都清理本地存储和状态
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      sessionStorage.removeItem('csrf_token');
      set({
        isAuthenticated: false,
        token: null,
        refreshToken: null,
        userRole: 'viewer',
        userInfo: null,
      });
      // 使用replace而不是href避免历史记录问题
      window.location.replace('/login');
    }
  },

  checkAuth: () => {
    const token = localStorage.getItem('auth_token');
    const refreshToken = localStorage.getItem('refresh_token');
    if (token) {
      set({
        isAuthenticated: true,
        token,
        refreshToken,
        userRole: 'admin',
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
}));
