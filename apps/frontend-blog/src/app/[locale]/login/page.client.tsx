'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  LogIn,
  Mail,
  Lock,
  ArrowRight,
  RefreshCw,
  Facebook,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { authApi } from '@/lib/api/authApi';
import { LoginGuard } from '@/components/auth/ProtectedRoute';

export default function LoginPageClient() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginWithEmail, isLoading } = useAuth();

  // 获取URL参数
  const client = searchParams.get('client'); // 'app' 或 'web'
  const callback = searchParams.get('callback'); // Deep Link URL
  const platform = searchParams.get('platform'); // 'ios' 或 'android'
  const inviteCode = searchParams.get('inviteCode'); // 邀请码

  // 判断是否来自App
  const isFromApp = client === 'app' && callback;

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const [isGooglePopupOpen, setIsGooglePopupOpen] = useState(false);

  // 生成Web flow的state参数（用于CSRF保护）
  const generateWebState = () => {
    const state = {
      provider: 'google',
      nonce: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      client: client || 'web',
    };
    // 使用标准的base64编码，替换URL不安全的字符
    const base64 = btoa(JSON.stringify(state));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  // 处理Google登录按钮点击 - 使用后端deep link endpoints
  const handleGoogleLoginClick = () => {
    try {
      setError(null);
      setIsOAuthLoading(true);

      const params = new URLSearchParams();

      // Web flow: redirect back to blog callback
      if (!isFromApp) {
        params.set('redirect_uri', `${window.location.origin}/oauth/callback`);
        params.set('state', generateWebState());
      }
      // App flow: use deep link callback
      else {
        if (callback) params.set('callback', callback);
        if (platform) params.set('platform', platform);
      }

      // 通用参数
      params.set('client', client || 'web');
      if (inviteCode) params.set('inviteCode', inviteCode);

      // 重定向到后端 OAuth 发起
      window.location.href = `/auth/google/login?${params.toString()}`;
    } catch (err: any) {
      setError(err.message || t('auth.oauth.googleFailed'));
      setIsOAuthLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('auth.invalidEmail'));
      return;
    }

    try {
      setIsSendingCode(true);
      setError(null);

      // 调用真实的发送验证码 API
      await authApi.sendEmailCode({ email });

      // 开始倒计时
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setError(err.message || t('auth.sendCodeFailed'));
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !code) {
      setError(t('auth.fillAllFields'));
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('auth.invalidEmail'));
      return;
    }

    if (code.length !== 6 || !/^\d+$/.test(code)) {
      setError(t('auth.invalidCode'));
      return;
    }

    try {
      await loginWithEmail(email, code);
      console.log('Login successful, waiting for store update...');
      // 等待store状态更新，然后让LoginGuard处理重定向
      // 使用setTimeout确保状态已更新
      setTimeout(() => {
        console.log('Checking redirect path after login...');
        const redirectPath = sessionStorage.getItem('redirectAfterLogin');
        if (redirectPath) {
          console.log('Redirecting to:', redirectPath);
          sessionStorage.removeItem('redirectAfterLogin');
          router.push(redirectPath);
        } else {
          console.log('Redirecting to home');
          router.push('/');
        }
      }, 100);
    } catch (err: any) {
      setError(err.message || t('auth.loginFailed'));
    }
  };

  // 处理Facebook登录按钮点击 - 使用后端deep link endpoints
  const handleFacebookLoginClick = () => {
    try {
      setError(null);
      setIsOAuthLoading(true);

      const params = new URLSearchParams();

      // Web flow: redirect back to blog callback
      if (!isFromApp) {
        params.set('redirect_uri', `${window.location.origin}/oauth/callback`);
        params.set('state', generateWebState());
      }
      // App flow: use deep link callback
      else {
        if (callback) params.set('callback', callback);
        if (platform) params.set('platform', platform);
      }

      // 通用参数
      params.set('client', client || 'web');
      if (inviteCode) params.set('inviteCode', inviteCode);

      // 重定向到后端 OAuth 发起
      window.location.href = `/auth/facebook/login?${params.toString()}`;
    } catch (err: any) {
      setError(err.message || t('auth.oauth.facebookFailed'));
      setIsOAuthLoading(false);
    }
  };

  return (
    <LoginGuard>
      <div className="min-h-[calc(100vh-10rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* 页面标题 */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">{t('auth.login.title')}</h1>
            <p className="text-muted-foreground">{t('auth.login.subtitle')}</p>
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700">{t('auth.login.tip')}</p>
            </div>
          </div>

          {/* 登录表单 */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 邮箱输入 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('auth.email')}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  />
                </div>
              </div>

              {/* 验证码输入 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {t('auth.verificationCode')}
                  </label>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={isSendingCode || countdown > 0}
                    className="text-sm text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isSendingCode ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {t('auth.sending')}
                      </>
                    ) : countdown > 0 ? (
                      `${t('auth.resendIn')} ${countdown}s`
                    ) : (
                      t('auth.sendCode')
                    )}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="text"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder={t('auth.codePlaceholder')}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    maxLength={6}
                  />
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                  {error}
                </div>
              )}

              {/* 登录按钮 */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                ) : (
                  <>
                    {t('auth.login.button')}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* 分隔线 */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-background text-muted-foreground">
                  {t('auth.orContinueWith')}
                </span>
              </div>
            </div>

            {/* OAuth 登录按钮 */}
            <div className="space-y-3">
              {/* Google按钮 - 使用弹窗模式 */}
              <button
                onClick={handleGoogleLoginClick}
                disabled={isOAuthLoading || isGooglePopupOpen}
                className="w-full py-3 px-4 rounded-xl border border-border bg-background hover:bg-accent/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                {t('auth.login.google')}
              </button>

              {/* Facebook按钮 */}
              <button
                onClick={handleFacebookLoginClick}
                disabled={isOAuthLoading}
                className="w-full py-3 px-4 rounded-xl border border-border bg-background hover:bg-accent/50 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Facebook className="w-5 h-5 text-[#1877F2]" />
                {t('auth.login.facebook')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </LoginGuard>
  );
}
