'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import type { User } from '@/lib/stores/auth.store';
import { authApi } from '@/lib/api/authApi';
import { withLocale } from '@/lib/utils/locale';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

// JWT解码函数
function decodeJWT(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(''),
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

/**
 * 从 cookie 获取用户的语言偏好
 * OAuth 回调页面在 [locale] 路由组之外，无法使用 useCurrentLocale()
 * 所以直接从 NEXT_LOCALE cookie 读取
 */
function getUserLocale(): string {
  try {
    if (typeof document === 'undefined') return DEFAULT_LOCALE;
    const match = document.cookie.match(
      new RegExp('(^| )NEXT_LOCALE=([^;]+)'),
    );
    if (match) return match[2];
    const legacyMatch = document.cookie.match(
      new RegExp('(^| )locale=([^;]+)'),
    );
    if (legacyMatch) return legacyMatch[2];
  } catch {
    // 忽略错误，使用默认语言
  }
  return DEFAULT_LOCALE;
}

// 主题同步函数
const syncTheme = () => {
  if (typeof window === 'undefined') return;

  try {
    // 从localStorage读取主题设置
    const savedTheme = localStorage.getItem('theme') || 'system';
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
      .matches
      ? 'dark'
      : 'light';
    const theme = savedTheme === 'system' ? systemTheme : savedTheme;

    // 应用到HTML元素
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    console.log('Theme synced:', { savedTheme, systemTheme, theme });
  } catch (err) {
    console.warn('Failed to sync theme:', err);
  }
};

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const store = useAuthStore();

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 组件加载时同步主题（现在由内联脚本处理，这里作为后备）
  useEffect(() => {
    // 内联脚本已经处理了主题，这里只作为后备
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme') || 'system';
      const isDark =
        savedTheme === 'dark' ||
        (savedTheme === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', isDark);
    }
  }, []);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 获取URL参数（后端重定向回来的参数）
        const token = searchParams.get('token');
        const refreshToken = searchParams.get('refreshToken');
        const errorParam = searchParams.get('error');
        const provider = searchParams.get('provider');

        // 检查是否有错误
        if (errorParam) {
          setError(`OAuth error: ${errorParam}`);
          setIsLoading(false);
          return;
        }

        // 验证必要的参数
        if (!token || !refreshToken) {
          setError('Missing authentication tokens');
          setIsLoading(false);
          return;
        }

        // 根据provider处理登录
        if (provider === 'google') {
          await handleGoogleLogin(token, refreshToken);
        } else if (provider === 'facebook') {
          await handleFacebookLogin(token, refreshToken);
        } else {
          // 如果没有provider参数，尝试从state参数解码
          const stateParam = searchParams.get('state');
          if (stateParam) {
            try {
              // 解码base64 state参数
              const base64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
              const state = JSON.parse(atob(base64));
              if (state.provider === 'google') {
                await handleGoogleLogin(token, refreshToken);
                return;
              } else if (state.provider === 'facebook') {
                await handleFacebookLogin(token, refreshToken);
                return;
              }
            } catch (err) {
              console.warn('Failed to decode state parameter:', err);
            }
          }

          // 默认使用通用登录
          await handleGenericLogin(token, refreshToken);
        }
      } catch (err: any) {
        setError(err.message || 'OAuth callback failed');
        setIsLoading(false);
      }
    };

    handleCallback();
  }, [searchParams]);

  const handleGoogleLogin = async (token: string, refreshToken: string) => {
    try {
      // 解码JWT token获取用户ID
      const payload = decodeJWT(token);
      const userId = payload?.sub || 'unknown-google-user';

      // 先设置token到store，让http.ts能获取到
      store.setTokens({ accessToken: token, refreshToken: refreshToken || '' });

      let user: User;

      try {
        // 使用标准authApi获取用户信息
        user = await authApi.getProfile();
      } catch (apiError) {
        console.warn(
          'Failed to fetch user profile from API, using JWT data:',
          apiError,
        );
        // 如果API调用失败，使用从token解码的基本信息
        user = {
          id: userId,
          phone: '',
          phoneMd5: '',
          nickname: payload?.name || 'Google User',
          avatar: payload?.picture || '',
          email: payload?.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
      }

      // 使用auth store登录（包含完整的用户信息）
      store.login(
        {
          accessToken: token,
          refreshToken: refreshToken || '',
        },
        user,
      );

      // 重定向到首页或指定页面（带 locale 前缀）
      setTimeout(() => {
        const locale = getUserLocale();
        const rawPath = sessionStorage.getItem('redirectAfterLogin');
        if (rawPath) {
          sessionStorage.removeItem('redirectAfterLogin');
          router.push(withLocale(rawPath, locale as any));
        } else {
          router.push(withLocale('/', locale as any));
        }
      }, 100);
    } catch (err: any) {
      setError(err.message || 'Google OAuth failed');
      setIsLoading(false);
    }
  };

  const handleFacebookLogin = async (token: string, refreshToken: string) => {
    try {
      // 解码JWT token获取用户ID
      const payload = decodeJWT(token);
      const userId = payload?.sub || 'unknown-facebook-user';

      // 先设置token到store，让http.ts能获取到
      store.setTokens({ accessToken: token, refreshToken: refreshToken || '' });

      let user: User;

      try {
        // 使用标准authApi获取用户信息
        user = await authApi.getProfile();
      } catch (apiError) {
        console.warn(
          'Failed to fetch user profile from API, using JWT data:',
          apiError,
        );
        // 如果API调用失败，使用从token解码的基本信息
        user = {
          id: userId,
          phone: '',
          phoneMd5: '',
          nickname: payload?.name || 'Facebook User',
          avatar: payload?.picture || '',
          email: payload?.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
      }

      // 使用auth store登录（包含完整的用户信息）
      store.login(
        {
          accessToken: token,
          refreshToken: refreshToken || '',
        },
        user,
      );

      // 重定向到首页或指定页面（带 locale 前缀）
      setTimeout(() => {
        const locale = getUserLocale();
        const rawPath = sessionStorage.getItem('redirectAfterLogin');
        if (rawPath) {
          sessionStorage.removeItem('redirectAfterLogin');
          router.push(withLocale(rawPath, locale as any));
        } else {
          router.push(withLocale('/', locale as any));
        }
      }, 100);
    } catch (err: any) {
      setError(err.message || 'Facebook OAuth failed');
      setIsLoading(false);
    }
  };

  const handleGenericLogin = async (token: string, refreshToken: string) => {
    try {
      // 解码JWT token获取用户ID
      const payload = decodeJWT(token);
      const userId = payload?.sub || 'unknown-oauth-user';

      // 先设置token到store，让http.ts能获取到
      store.setTokens({ accessToken: token, refreshToken: refreshToken || '' });

      let user: User;

      try {
        // 使用标准authApi获取用户信息
        user = await authApi.getProfile();
      } catch (apiError) {
        console.warn(
          'Failed to fetch user profile from API, using JWT data:',
          apiError,
        );
        // 如果API调用失败，使用从token解码的基本信息
        user = {
          id: userId,
          phone: '',
          phoneMd5: '',
          nickname: payload?.name || 'OAuth User',
          avatar: payload?.picture || '',
          email: payload?.email || '',
          inviteCode: null,
          vipLevel: 0,
          lastLoginAt: null,
          kycStatus: 'pending',
          selfExclusionExpireAt: 0,
        };
      }

      // 使用auth store登录（包含完整的用户信息）
      store.login(
        {
          accessToken: token,
          refreshToken: refreshToken || '',
        },
        user,
      );

      // 重定向到首页或指定页面（带 locale 前缀）
      setTimeout(() => {
        const locale = getUserLocale();
        const rawPath = sessionStorage.getItem('redirectAfterLogin');
        if (rawPath) {
          sessionStorage.removeItem('redirectAfterLogin');
          router.push(withLocale(rawPath, locale as any));
        } else {
          router.push(withLocale('/', locale as any));
        }
      }, 100);
    } catch (err: any) {
      setError(err.message || 'OAuth login failed');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {isLoading ? (
          <div className="space-y-4">
            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-lg font-medium">Processing OAuth callback...</p>
            <p className="text-sm text-muted-foreground">
              Please wait while we complete the authentication process.
            </p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <p className="text-lg font-medium text-red-600">
              Authentication Failed
            </p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => router.push('/login')}
              className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Back to Login
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-lg font-medium">Authentication Successful</p>
            <p className="text-sm text-muted-foreground">
              Redirecting you to the application...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <div className="space-y-4">
              <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
              <p className="text-lg font-medium">Loading OAuth callback...</p>
              <p className="text-sm text-muted-foreground">
                Please wait while we prepare the authentication process.
              </p>
            </div>
          </div>
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}
