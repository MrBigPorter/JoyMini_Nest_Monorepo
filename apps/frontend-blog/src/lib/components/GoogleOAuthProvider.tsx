'use client';

import { GoogleOAuthProvider as GoogleProvider } from '@react-oauth/google';

interface GoogleOAuthProviderProps {
  children: React.ReactNode;
}

let googleProviderInstance: React.ReactNode | null = null;

/**
 * Google OAuth提供者组件
 * 包装应用以提供Google OAuth功能
 * 单例模式，避免重复渲染导致的 hydration 问题
 */
export function GoogleOAuthProvider({ children }: GoogleOAuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (typeof window === 'undefined') {
    // SSR 时不渲染 GoogleProvider，避免 hydration 不匹配
    return <>{children}</>;
  }

  if (!clientId) {
    console.warn(
      'Google OAuth Client ID is not configured. Google login will not work.',
    );
    return <>{children}</>;
  }

  // 单例模式，避免重复渲染
  if (!googleProviderInstance) {
    googleProviderInstance = <GoogleProvider clientId={clientId}>{children}</GoogleProvider>;
  }

  return googleProviderInstance;
}
