import { NextRequest, NextResponse } from 'next/server';
import { detectLocaleFromRequest, FALLBACK_LOCALE } from '@/lib/utils/locale';
import type { Locale } from '@/lib/utils/locale';

/**
 * Available locale codes — defined inline to avoid importing @lucky/shared.
 * @lucky/shared → order-no.helper.ts uses node:crypto which cannot be
 * resolved on Edge Runtime (where middleware runs).
 */
const AVAILABLE_LOCALES = ['en', 'zh', 'ja', 'ko', 'fr', 'de'] as const;

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = JSON.parse(atob(payload));
    return decoded;
  } catch {
    return null;
  }
}

function isJwtExpiredOrMalformed(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  if (!payload.exp) return true;
  return Date.now() >= payload.exp * 1000;
}

function clearAuthCookie(request: NextRequest, response: NextResponse) {
  const domain = process.env.AUTH_COOKIE_DOMAIN || undefined;
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    ...(domain ? { domain } : {}),
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths that don't require authentication
  const publicPaths = ['/login', '/privacy-policy'];
  const isPublicPath = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(path + '/'),
  );

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/monitoring') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // ── Locale detection (first visit, no cookie) ─────────────────────────────
  // Only auto-detect when user hasn't chosen a locale yet (no NEXT_LOCALE cookie).
  const existingLocale = request.cookies.get('NEXT_LOCALE')?.value;
  let detectedLocale: string | undefined;

  if (
    !existingLocale ||
    !AVAILABLE_LOCALES.includes(existingLocale as Locale)
  ) {
    const detected = detectLocaleFromRequest(request);
    // Only set cookie if detected locale differs from FALLBACK_LOCALE
    // (FALLBACK_LOCALE = 'en' is the default, no need to persist it)
    if (detected !== FALLBACK_LOCALE) {
      detectedLocale = detected;
    }
  }

  // Helper: apply locale cookie to a response
  const applyLocaleCookie = (res: NextResponse) => {
    if (detectedLocale) {
      res.cookies.set('NEXT_LOCALE', detectedLocale, {
        path: '/',
        maxAge: 31536000, // 1 year
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
  };

  // ── Auth check ────────────────────────────────────────────────────────────
  const authToken = request.cookies.get('auth_token')?.value;

  // If no token or token is expired
  if (!authToken || isJwtExpiredOrMalformed(authToken)) {
    // If it's a public path, allow access
    if (isPublicPath) {
      const response = NextResponse.next();
      applyLocaleCookie(response);
      if (authToken && isJwtExpiredOrMalformed(authToken)) {
        clearAuthCookie(request, response);
      }
      return response;
    }
    // Redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    // Apply locale cookie to redirect response too
    const response = NextResponse.redirect(loginUrl);
    applyLocaleCookie(response);
    return response;
  }

  // If authenticated and trying to access login page, redirect to home
  if (pathname === '/login') {
    const response = NextResponse.redirect(new URL('/', request.url));
    applyLocaleCookie(response);
    return response;
  }

  // Set x-pathname header for route matching in layouts
  const response = NextResponse.next();
  response.headers.set('x-pathname', pathname);
  applyLocaleCookie(response);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
