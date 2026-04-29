'use client';

import { useEffect, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth.store';
import type { User } from '@/lib/stores/auth.store';
import { authApi } from '@/lib/api/authApi';
import { withLocale, SupportedLocale } from '@/lib/utils/locale';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

interface JWTPayload {
  sub?: string;
  name?: string;
  picture?: string;
  email?: string;
  [key: string]: unknown;
}

// JWT解码函数
function decodeJWT(token: string): JWTPayload | null {
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
    const match = document.cookie.match(new RegExp('(^| )NEXT_LOCALE=([^;]+)'));
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

const PROVIDER_CONFIG = {
  google: {
    defaultNickname: 'Google User',
    defaultId: 'unknown-google-user',
  },
  facebook: {
    defaultNickname: 'Facebook User',
    defaultId: 'unknown-facebook-user',
  },
  generic: {
    defaultNickname: 'OAuth User',
    defaultId: 'unknown-oauth-user',
  },
} as const;

type OAuthProvider = keyof typeof PROVIDER_CONFIG;

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setTokens = useAuthStore((s) => s.setTokens);
  const login = useAuthStore((s) => s.login);

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

  const handleOAuthLogin = useCallback(
    async (token: string, refreshToken: string, provider: OAuthProvider) => {
      try {
        const config = PROVIDER_CONFIG[provider];
        // 解码JWT token获取用户ID
        const payload = decodeJWT(token);
        const userId = payload?.sub || config.defaultId;

        // 先设置token到store，让http.ts能获取到
        setTokens({ accessToken: token, refreshToken: refreshToken || '' });

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
            nickname: payload?.name || config.defaultNickname,
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
        login(
          {
            accessToken: token,
            refreshToken: refreshToken || '',
          },
          user,
        );

        // 重定向到首页或指定页面（带 locale 前缀）
        setTimeout(() => {
          const locale = getUserLocale() as SupportedLocale;
          const rawPath = sessionStorage.getItem('redirectAfterLogin');
          if (rawPath) {
            sessionStorage.removeItem('redirectAfterLogin');
            router.push(withLocale(rawPath, locale));
          } else {
            router.push(withLocale('/', locale));
          }
        }, 100);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : `${provider} OAuth failed`,
        );
        setIsLoading(false);
      }
    },
    [setTokens, login, router],
  );

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
          await handleOAuthLogin(token, refreshToken, 'google');
        } else if (provider === 'facebook') {
          await handleOAuthLogin(token, refreshToken, 'facebook');
        } else {
          // 如果没有provider参数，尝试从state参数解码
          const stateParam = searchParams.get('state');
          if (stateParam) {
            try {
              // 解码base64 state参数
              const base64 = stateParam.replace(/-/g, '+').replace(/_/g, '/');
              const state = JSON.parse(atob(base64));
              if (state.provider === 'google') {
                await handleOAuthLogin(token, refreshToken, 'google');
                return;
              } else if (state.provider === 'facebook') {
                await handleOAuthLogin(token, refreshToken, 'facebook');
                return;
              }
            } catch (err) {
              console.warn('Failed to decode state parameter:', err);
            }
          }

          // 默认使用通用登录
          await handleOAuthLogin(token, refreshToken, 'generic');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'OAuth callback failed');
        setIsLoading(false);
      }
    };

    void handleCallback();
  }, [searchParams, handleOAuthLogin]);

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
