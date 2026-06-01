import { NextRequest, NextResponse } from 'next/server';
import { detectLocaleFromRequest, FALLBACK_LOCALE } from '@/lib/utils/locale';
import type { Locale } from '@/lib/utils/locale';

/**
 * Available locale codes — defined inline to avoid importing @lucky/shared.
 * @lucky/shared → order-no.helper.ts uses node:crypto which cannot be
 * resolved on Edge Runtime (where middleware runs).
 */
const AVAILABLE_LOCALES = ['en', 'zh', 'ja', 'ko', 'fr', 'de'] as const;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  // Set x-pathname header for route matching in layouts
  const response = NextResponse.next();
  response.headers.set('x-pathname', pathname);
  applyLocaleCookie(response);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
