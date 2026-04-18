'use client';

interface GoogleOAuthProviderProps {
  children: React.ReactNode;
}

/**
 * Google OAuth提供者组件（简化版）
 * 由于项目未安装 @react-oauth/google 模块，此组件仅作为占位符
 * 实际使用时需要安装相应的依赖
 */
export function GoogleOAuthProvider({ children }: GoogleOAuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  if (typeof window === 'undefined') {
    // SSR 时不渲染，避免 hydration 不匹配
    return <>{children}</>;
  }

  if (!clientId) {
    console.warn(
      'Google OAuth Client ID is not configured. Google login will not work.',
    );
    return <>{children}</>;
  }

  // 由于缺少 @react-oauth/google 模块，直接返回子组件
  // 实际使用时需要安装依赖并实现完整的Google OAuth功能
  console.warn(
    '@react-oauth/google module is not installed. Google OAuth functionality is disabled.',
  );
  
  return <>{children}</>;
}
