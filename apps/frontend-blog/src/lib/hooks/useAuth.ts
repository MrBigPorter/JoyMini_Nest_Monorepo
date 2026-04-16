import { useCallback, useEffect } from 'react';
import { useAuthStore, type User } from '@/lib/stores/auth.store';
import { authApi, type LoginResponse } from '@/lib/api/authApi';

export function useAuth() {
  const store = useAuthStore();

  // 只使用 store 的 loading 状态，不包含水合状态
  // 这样即使水合未完成，组件也能看到真实的认证状态
  const isLoading = store.isLoading;
  // 计算认证状态
  const isAuthenticated = !!(store.accessToken && store.user);

  // 组件挂载时验证现有token（如果有）
  useEffect(() => {
    const validateExistingTokens = async () => {
      console.log('useAuth: validateExistingTokens called');

      // 只验证已存在的token，不手动加载
      // Zustand的persist中间件会自动处理hydration
      if (store.accessToken && store.user) {
        try {
          console.log(
            'useAuth: Found existing tokens, validation can be done here if needed',
          );
          // 这里可以添加token验证逻辑，但暂时只记录
        } catch (error) {
          console.error('Token validation failed:', error);
          store.logout();
        }
      } else {
        console.log(
          'useAuth: No existing tokens found, relying on Zustand hydration',
        );
      }
    };

    validateExistingTokens();
  }, [store]);

  /**
   * 邮箱验证码登录
   */
  const loginWithEmail = useCallback(
    async (emailParam: string, code: string) => {
      try {
        store.setLoading(true);
        const data = await authApi.loginWithEmailCode(emailParam, code);
        console.log('Login API response:', data);

        const user: User = {
          id: data.id,
          phone: data.phone || '',
          phoneMd5: data.phoneMd5 || '',
          nickname: data.nickname || data.username || '',
          avatar: data.avatar,
          email: data.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
        console.log('User object for store:', user);
        store.login(
          {
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken,
          },
          user,
        );

        return data;
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
        const data = await authApi.loginWithOtp(phone, code);
        console.log('Phone login API response:', data);

        const user: User = {
          id: data.id,
          phone: data.phone || '',
          phoneMd5: data.phoneMd5 || '',
          nickname: data.nickname || data.username || '',
          avatar: data.avatar,
          email: data.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
        store.login(
          {
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken,
          },
          user,
        );

        return data;
      } finally {
        store.setLoading(false);
      }
    },
    [store],
  );

  /**
   * Google OAuth 登录
   */
  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      try {
        store.setLoading(true);
        const data = await authApi.loginWithGoogle(idToken);
        console.log('Google OAuth login API response:', data);

        const user: User = {
          id: data.id,
          phone: data.phone || '',
          phoneMd5: data.phoneMd5 || '',
          nickname: data.nickname || data.username || '',
          avatar: data.avatar,
          email: data.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
        store.login(
          {
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken,
          },
          user,
        );

        return data;
      } finally {
        store.setLoading(false);
      }
    },
    [store],
  );

  /**
   * Facebook OAuth 登录
   */
  const loginWithFacebook = useCallback(
    async (accessToken: string, userId: string) => {
      try {
        store.setLoading(true);
        const data = await authApi.loginWithFacebook(accessToken, userId);
        console.log('Facebook OAuth login API response:', data);

        const user: User = {
          id: data.id,
          phone: data.phone || '',
          phoneMd5: data.phoneMd5 || '',
          nickname: data.nickname || data.username || '',
          avatar: data.avatar,
          email: data.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
        store.login(
          {
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken,
          },
          user,
        );

        return data;
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
      const data = await authApi.refreshToken(store.refreshToken);
      console.log('Refresh token response:', data);
      store.setTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return data;
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
    if (!store.accessToken) {
      return false;
    }

    try {
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
  }, [store, refreshTokenFn]);

  return {
    // 状态
    user: store.user,
    accessToken: store.accessToken,
    refreshToken: store.refreshToken,
    isAuthenticated: isAuthenticated,
    isLoading: isLoading,

    // 操作方法
    loginWithEmail,
    loginWithPhone,
    loginWithGoogle,
    loginWithFacebook,
    logout,
    refreshTokenFn,
    fetchProfile,
    updateProfile,
    checkAuth,

    // 工具方法
    hasRole: (role: string) => {
      return false;
    },

    hasPermission: (permission: string) => {
      return false;
    },
  };
}

export type UseAuthReturn = ReturnType<typeof useAuth>;