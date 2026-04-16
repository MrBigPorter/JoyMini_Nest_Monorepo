import { NextRequest, NextResponse } from 'next/server';
import { authApi } from '@/lib/api/authApi';

/**
 * Github OAuth回调处理
 * 处理Github OAuth授权码，交换access token，然后调用后端API登录
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // 检查是否有错误
    if (error) {
      console.error('Github OAuth error:', error, errorDescription);
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(errorDescription || error)}`,
          request.url,
        ),
      );
    }

    // 验证必要参数
    if (!code) {
      console.error('Missing code parameter');
      return NextResponse.redirect(
        new URL('/login?error=Missing authorization code', request.url),
      );
    }

    // 验证state参数防止CSRF攻击
    const savedState = request.cookies.get('github_oauth_state')?.value;
    if (!state || !savedState || state !== savedState) {
      console.error('Invalid or missing state parameter');
      return NextResponse.redirect(
        new URL('/login?error=Invalid state parameter', request.url),
      );
    }

    // 调用后端API进行Github登录
    try {
      const response = await authApi.loginWithGithub(code);

      // 登录成功，重定向到首页或原始页面
      const redirectPath =
        request.cookies.get('redirectAfterLogin')?.value || '/';

      // 创建重定向响应
      const redirectUrl = new URL(redirectPath, request.url);

      // 设置token到cookie（如果需要）
      const responseCookies = new NextResponse(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
        },
      });

      // 清除state cookie
      responseCookies.cookies.delete('github_oauth_state');
      responseCookies.cookies.delete('redirectAfterLogin');

      return responseCookies;
    } catch (apiError: any) {
      console.error('Github login API error:', apiError);
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(apiError.message || 'Github login failed')}`,
          request.url,
        ),
      );
    }
  } catch (error: any) {
    console.error('Github OAuth callback error:', error);
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error.message || 'Internal server error')}`,
        request.url,
      ),
    );
  }
}

/**
 * 处理Github OAuth回调的POST请求（如果需要）
 */
export async function POST(request: NextRequest) {
  return GET(request);
}
