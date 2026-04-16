'use client';

import { GoogleOAuthProvider as GoogleProvider } from '@react-oauth/google';

interface GoogleOAuthProviderProps {
  children: React.ReactNode;
}

/**
 * Google OAuth提供者组件
 * 包装应用以提供Google OAuth功能
 */
export function GoogleOAuthProvider({ children }: GoogleOAuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.warn(
      'Google OAuth Client ID is not configured. Google login will not work.',
    );
    return <>{children}</>;
  }

  return <GoogleProvider clientId={clientId}>{children}</GoogleProvider>;
}
