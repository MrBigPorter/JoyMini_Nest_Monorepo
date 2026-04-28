'use client';

import React, { useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { z } from 'zod';
import { useRequest } from 'ahooks';
import { useAuthStore } from '@/store/useAuthStore';
import { useToastStore } from '@/store/useToastStore';
import { Button, Input } from '@/components/UIComponents';
import { ArrowRight, Lock, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { authApi } from '@/api';
import { LoginResponse, UserRole } from '@/type/types';
import { sanitizeInput, generateCsrfToken } from '@/lib/security-utils';
import { useTranslation } from '@/hooks/useTranslation';

const loginSchema = (t: (key: string) => string) =>
  z.object({
    username: z
      .string()
      .min(1, { message: t('login.usernameRequired') })
      .max(50, { message: t('login.usernameTooLong') }),
    password: z
      .string()
      .min(6, { message: t('login.passwordMinLength') })
      .max(128, { message: t('login.passwordTooLong') }),
  });

type LoginFormInputs = z.infer<ReturnType<typeof loginSchema>>;

async function signIn(data: LoginFormInputs): Promise<LoginResponse> {
  return await authApi.login(data);
}

export const Login: React.FC = () => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const loginAction = useAuthStore((state) => state.login);
  const addToast = useToastStore((state) => state.addToast);
  const [csrfToken, setCsrfToken] = React.useState<string>('');
  const { t } = useTranslation();

  // 生成 CSRF Token
  React.useEffect(() => {
    const token = generateCsrfToken();
    setCsrfToken(token);
    // 存储到 sessionStorage 用于验证
    sessionStorage.setItem('csrf_token', token);
  }, []);

  // 登录页挂载时，检测并清理本地残留 token（middleware 已清理 cookie）
  React.useEffect(() => {
    const hasLocalToken = Boolean(
      localStorage.getItem('auth_token') ||
      localStorage.getItem('refresh_token'),
    );
    if (!hasLocalToken) {
      return;
    }

    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    sessionStorage.removeItem('csrf_token');
    void authApi.clearCookie().catch(() => {});
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormInputs>({
    resolver: zodResolver(loginSchema(t)),
  });

  const { loading, runAsync } = useRequest(signIn, {
    manual: true,
    onSuccess: async (result) => {
      if (result.tokens.accessToken) {
        await loginAction(
          result.tokens.accessToken,
          result.userInfo.role as UserRole,
          result.userInfo,
          result.tokens.refreshToken ?? null,
        );
        addToast('success', t('login.welcomeBack'));
        // 使用 startTransition 优化路由转换性能
        startTransition(() => {
          router.push('/');
        });
      } else {
        addToast('error', t('login.loginFailedNoToken'));
      }
    },
    onError: (error: unknown) => {
      // 后端统一响应格式: { code, message, data, tid }
      // axios error 结构: { response: { data: { code, message } }, message: "Request failed..." }
      let message = t('login.loginFailedGeneric');

      if (typeof error === 'object' && error !== null) {
        // 优先取后端 response body 里的 message
        const axiosError = error as {
          response?: { data?: { message?: string; msg?: string } };
          message?: string;
        };
        const apiMsg =
          axiosError.response?.data?.message ?? axiosError.response?.data?.msg;
        if (apiMsg) {
          message = apiMsg;
        } else if (axiosError.message) {
          message = axiosError.message;
        }
      } else if (typeof error === 'string') {
        message = error;
      }

      addToast('error', message);
    },
  });

  // handleSubmit 内部已调用 e.preventDefault()，不会触发页面刷新
  // try-catch 确保 runAsync 的异常不会变成 unhandled rejection 导致上层错误边界重载
  const onSubmit = async (data: LoginFormInputs) => {
    try {
      // sanitizeInput 在 submit handler 里手动处理（禁止在 Zod schema 里用 .transform()）
      await runAsync({ ...data, username: sanitizeInput(data.username) });
    } catch {
      // 错误已通过 useRequest 的 onError 处理并显示 toast，这里静默即可
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-dark-950 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <motion.div
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary-500/10 rounded-full blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], x: [0, -20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px]"
        />
      </div>

      <div className="w-full max-w-md p-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="bg-white dark:bg-dark-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-white/5 p-8 md:p-10"
        >
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="mb-4"
            >
              <Image
                src="/logo.png"
                alt="JoyMini Blog Admin"
                width={48}
                height={48}
                className="rounded-xl"
                priority
              />
            </motion.div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('login.title')}
            </h1>
            <p className="text-gray-500 text-sm text-center">
              {t('login.subtitle')}
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* CSRF Token */}
            <input type="hidden" name="_csrf" value={csrfToken} />

            <div className="space-y-4">
              <div className="relative group">
                <User
                  className="absolute left-3 top-3 text-gray-400 group-focus-within:text-primary-500 transition-colors"
                  size={18}
                />
                <Input
                  className="pl-10"
                  type="text"
                  placeholder={t('login.usernamePlaceholder')}
                  aria-label={t('login.usernameLabel')}
                  autoComplete="username"
                  error={errors.username?.message}
                  {...register('username')}
                />
              </div>
              <div className="relative group">
                <Lock
                  className="absolute left-3 top-3 text-gray-400 group-focus-within:text-primary-500 transition-colors"
                  size={18}
                />
                <Input
                  className="pl-10"
                  type="password"
                  placeholder={t('login.passwordPlaceholder')}
                  aria-label={t('login.passwordLabel')}
                  autoComplete="current-password"
                  error={errors.password?.message}
                  {...register('password')}
                />
              </div>
            </div>
            <Button
              type="submit"
              className="w-full py-3 text-lg shadow-xl shadow-primary-500/20"
              isLoading={loading || isPending}
              disabled={loading || isPending}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {t('login.signIn')} <ArrowRight size={18} />
              </span>
            </Button>
          </form>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 text-center text-gray-400 text-xs"
        >
          {t('login.copyright', { year: new Date().getFullYear() })}
        </motion.div>
      </div>
    </div>
  );
};
