import { NextRequest, NextResponse } from 'next/server';
import { detectLocaleFromRequest } from '@/lib/utils/locale';
import type { Locale } from '@/lib/utils/locale';

/**
 * Middleware — 在 dev 和 production 均生效（Cloudflare Workers Edge Runtime 支持 Next.js middleware）。
 * 职责: 服务端路由守卫，读取 Cookie 中的 auth_token 判断是否已登录。
 *   - 未登录访问受保护页面 → 302 跳转 /login
 *   - 已登录访问 /login → 302 跳转 /（防止重复登录）
 * 注: 静态资源（/_next/*、favicon 等）直接放行，不走认证逻辑。
 *
 * Locale detection: 首次访问时根据 Accept-Language 设置 app_locale cookie。
 *   优先顺序: URL 路径中的 locale（由 next-intl 处理）> app_locale cookie > Accept-Language
 */

const PUBLIC_PATHS = ['/login', '/register-apply', '/privacy-policy'];

/**
 * Available locale codes — defined inline to avoid importing @lucky/shared.
 * @lucky/shared → order-no.helper.ts uses node:crypto which cannot be
 * resolved on Edge Runtime (where middleware runs).
 */
const AVAILABLE_LOCALES = ['en', 'zh', 'ja', 'ko', 'fr', 'de'] as const;

function isExactOrSubPath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    );
    const json = atob(padded);
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}

function isJwtExpiredOrMalformed(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now;
}

function clearAuthCookie(request: NextRequest, response: NextResponse) {
  const hostname = request.nextUrl.hostname;
  const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  const domains = new Set<string | null>([null]);

  if (configuredDomain) {
    domains.add(configuredDomain);
  }
  if (hostname.endsWith('joyminis.com')) {
    domains.add('.joyminis.com');
  }

  for (const domain of domains) {
    response.cookies.set('auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
      maxAge: 0,
      ...(domain ? { domain } : {}),
    });
  }
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 跳过静态资源与 metadata 资源
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon') ||
    pathname === '/manifest.webmanifest' ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // ── Locale detection (first visit, no cookie) ─────────────────────────────
  // Only auto-detect when user hasn't chosen a locale yet (no app_locale cookie).
  // Unlike admin-blog, we ALWAYS set the cookie even for English, because
  // admin-next's DEFAULT_LOCALE is 'zh' — an English browser should see English.
  const existingLocale = request.cookies.get('app_locale')?.value;
  let detectedLocale: string | undefined;

  if (
    !existingLocale ||
    !(AVAILABLE_LOCALES as readonly string[]).includes(existingLocale)
  ) {
    const detected = detectLocaleFromRequest(request);
    detectedLocale = detected;
  }

  // Helper: apply locale cookie to a response
  const applyLocaleCookie = (res: NextResponse) => {
    if (detectedLocale) {
      res.cookies.set('app_locale', detectedLocale, {
        path: '/',
        maxAge: 31536000, // 1 year
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
  };

  const token = request.cookies.get('auth_token')?.value ?? null;
  const hasToken = token !== null;
  const isTokenInvalid = hasToken && isJwtExpiredOrMalformed(token);

  const isPublicPath = PUBLIC_PATHS.some((p) => isExactOrSubPath(pathname, p));

  // 访问登录页时：无效 token 主动清理并放行，有效 token 才重定向首页
  if (pathname === '/login') {
    if (hasToken && !isTokenInvalid) {
      // 有效 token 访问登录页 → 重定向到首页（防止重复登录）
      const response = NextResponse.redirect(new URL('/', request.url));
      applyLocaleCookie(response);
      return response;
    }
    // 无 token 或 token 无效 → 放行登录页，并清理脏 cookie
    const response = NextResponse.next();
    if (isTokenInvalid) {
      clearAuthCookie(request, response);
    }
    applyLocaleCookie(response);
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // 未登录或 token 无效访问其他受保护页面 → 跳登录页
  if ((!hasToken || isTokenInvalid) && !isPublicPath) {
    const loginUrl = new URL('/login', request.url);
    // 保留 test/code 参数用于 auto-login（demo/interview 场景）
    const test = searchParams.get('test');
    const code = searchParams.get('code');
    if (test) loginUrl.searchParams.set('test', test);
    if (code) loginUrl.searchParams.set('code', code);
    const response = NextResponse.redirect(loginUrl);
    if (isTokenInvalid) {
      clearAuthCookie(request, response);
    }
    applyLocaleCookie(response);
    return response;
  }

  // 有效 token 访问其他公开页（register-apply、privacy-policy）→ 跳首页
  if (hasToken && !isTokenInvalid && isPublicPath) {
    const response = NextResponse.redirect(new URL('/', request.url));
    applyLocaleCookie(response);
    return response;
  }

  const response = NextResponse.next();
  if (isTokenInvalid) {
    clearAuthCookie(request, response);
  }
  applyLocaleCookie(response);
  response.headers.set('x-pathname', pathname);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
