import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware — 在 dev 和 production 均生效（Cloudflare Workers Edge Runtime 支持 Next.js middleware）。
 * 职责: 服务端路由守卫，读取 Cookie 中的 auth_token 判断是否已登录。
 *   - 未登录访问受保护页面 → 302 跳转 /login
 *   - 已登录访问 /login → 302 跳转 /（防止重复登录）
 * 注: 静态资源（/_next/*、favicon 等）直接放行，不走认证逻辑。
 */

const PUBLIC_PATHS = ['/login', '/register-apply', '/privacy-policy'];

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

  const token = request.cookies.get('auth_token')?.value ?? null;
  const hasToken = token !== null;
  const isTokenInvalid = hasToken && isJwtExpiredOrMalformed(token);

  const isPublicPath = PUBLIC_PATHS.some((p) => isExactOrSubPath(pathname, p));

  // 访问登录页时：无效 token 主动清理并放行，有效 token 才重定向首页
  if (pathname === '/login') {
    if (hasToken && !isTokenInvalid) {
      // 有效 token 访问登录页 → 重定向到首页（防止重复登录）
      return NextResponse.redirect(new URL('/', request.url));
    }
    // 无 token 或 token 无效 → 放行登录页，并清理脏 cookie
    const response = NextResponse.next();
    if (isTokenInvalid) {
      clearAuthCookie(request, response);
    }
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // 未登录或 token 无效访问其他受保护页面 → 跳登录页
  if ((!hasToken || isTokenInvalid) && !isPublicPath) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    if (isTokenInvalid) {
      clearAuthCookie(request, response);
    }
    return response;
  }

  // 有效 token 访问其他公开页（register-apply、privacy-policy）→ 跳首页
  if (hasToken && !isTokenInvalid && isPublicPath) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const response = NextResponse.next();
  if (isTokenInvalid) {
    clearAuthCookie(request, response);
  }
  response.headers.set('x-pathname', pathname);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
