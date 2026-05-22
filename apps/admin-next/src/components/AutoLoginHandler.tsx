'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { authApi } from '@/api';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Auto-login via URL query params for demo/interview scenarios.
 * Reads ?test=xxx&code=xxx from URL, calls backend test-login endpoint,
 * and if successful, stores tokens and redirects to dashboard.
 */
export function AutoLoginHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const attempted = useRef(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    const test = searchParams?.get('test');
    const code = searchParams?.get('code');
    if (!test || !code) return;
    if (attempted.current) return;
    attempted.current = true;
    if (isAuthenticated) return;

    const doAutoLogin = async () => {
      let success = false;
      try {
        const result = await authApi.testLogin({ test, code });
        if (result?.tokens?.accessToken) {
          await login(
            result.tokens.accessToken,
            (result.userInfo?.role ?? 'admin') as any,
            result.userInfo,
            result.tokens.refreshToken ?? null,
          );
          success = true;
          // redirect to dashboard
          router.replace('/');
        }
      } catch {
        // silent: test login failed, stay on current page
      } finally {
        // Only clean up query params on failure (stay on current page).
        // On success, the router.replace('/') above handles navigation.
        if (!success) {
          const params = new URLSearchParams(searchParams.toString());
          params.delete('test');
          params.delete('code');
          const query = params.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
        }
      }
    };
    doAutoLogin();
  }, [searchParams, pathname, router, isAuthenticated, login]);

  return null;
}
