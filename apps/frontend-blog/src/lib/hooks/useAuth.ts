import { useCallback } from 'react';
import { useAuthStore, type User } from '@/lib/stores/auth.store';
import { authApi, type LoginResponse } from '@/lib/api/authApi';

export function useAuth() {
  const store = useAuthStore();

  /**
   * 邮箱验证码登录
   */
  const loginWithEmail = useCallback(
    async (email: string, code: string) => {
      try {
        store.setLoading(true);
        const result = await authApi.loginWithEmailCode(email, code);
        const { accessToken, refreshToken, user } = result.data;
        store.login({ accessToken, refreshToken }, user);
        return result;
      } finally {
        store.setLoading(false);
      }
    },
    [store],
  );

  /**
   * 手机验证码登录
   */
  const loginWithPhone = useCallback(
    async (phone: string, code: string) => {
      try {
        store.setLoading(true);
        const result = await authApi.loginWithOtp(phone, code);
        const { accessToken, refreshToken, user } = result.data;
        store.login({ accessToken, refreshToken }, user);
        return result;
      } finally {
        store.setLoading(false);
      }
    },
    [store],
  );

  /**
   * OAuth 登录
   */
  const loginWithOAuth = useCallback(
    async (provider: 'google' | 'facebook' | 'apple', token: string) => {
      try {
        store.setLoading(true);
        const result = await authApi.loginWithOAuth({ provider, token });
        const { accessToken, refreshToken, user } = result.data;
        store.login({ accessToken, refreshToken }, user);
        return result;
      } finally {
        store.setLoading(false);
      }
    },
    [store],
  );

  /**
   * 登出
   */
  const logout = useCallback(async () => {
    try {
      // 可选：调用后端登出接口
      await authApi.logout();
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      store.logout();
    }
  }, [store]);

  /**
   * 刷新 Token
   */
  const refreshTokenFn = useCallback(async () => {
    if (!store.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const result = await authApi.refreshToken(store.refreshToken);
      const { accessToken, refreshToken: newRefreshToken } = result.data;
      store.setTokens({ accessToken, refreshToken: newRefreshToken });
      return result;
    } catch (error) {
      store.logout();
      throw error;
    }
  }, [store]);

  /**
   * 获取用户信息
   */
  const fetchProfile = useCallback(async () => {
    try {
      store.setLoading(true);
      const user = await authApi.getProfile();
      store.setUser(user);
      return user;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  /**
   * 更新用户信息
   */
  const updateProfile = useCallback(
    async (data: Partial<User>) => {
      try {
        store.setLoading(true);
        const user = await authApi.updateProfile(data);
        store.setUser(user);
        return user;
      } finally {
        store.setLoading(false);
      }
    },
    [store],
  );

  /**
   * 检查登录状态
   */
  const checkAuth = useCallback(async () => {
    if (!store.isAuthenticated || !store.accessToken) {
      return false;
    }

    try {
      // 可选：验证 token 是否有效
      await authApi.getProfile();
      return true;
    } catch (error: any) {
      // 如果 token 无效，尝试刷新
      if (error.response?.status === 401) {
        try {
          await refreshTokenFn();
          return true;
        } catch (refreshError) {
          store.logout();
          return false;
        }
      }
      return false;
    }
  }, [store, refreshTokenFn]);

  /**
   * 初始化认证状态
   */
  const initializeAuth = useCallback(async () => {
    if (store.isAuthenticated && store.accessToken) {
      try {
        // 验证 token 是否有效
        await authApi.getProfile();
        return true;
      } catch (error: any) {
        if (error.response?.status === 401) {
          try {
            await refreshTokenFn();
            return true;
          } catch (refreshError) {
            store.logout();
            return false;
          }
        }
        return false;
      }
    }
    return false;
  }, [store, refreshTokenFn]);

  return {
    // 状态
    user: store.user,
    accessToken: store.accessToken,
    refreshToken: store.refreshToken,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,

    // 操作方法
    loginWithEmail,
    loginWithPhone,
    loginWithOAuth,
    logout,
    refreshTokenFn,
    fetchProfile,
    updateProfile,
    checkAuth,
    initializeAuth,

    // 工具方法
    hasRole: (role: string) => {
      // 根据实际需求实现角色检查
      return false;
    },

    hasPermission: (permission: string) => {
      // 根据实际需求实现权限检查
      return false;
    },
  };
}

export type UseAuthReturn = ReturnType<typeof useAuth>;
