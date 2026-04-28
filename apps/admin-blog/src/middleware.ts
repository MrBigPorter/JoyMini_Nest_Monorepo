import { NextRequest, NextResponse } from 'next/server';

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
  const publicPaths = ['/login', '/register-apply', '/privacy-policy'];
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

  const authToken = request.cookies.get('auth_token')?.value;

  // If no token or token is expired
  if (!authToken || isJwtExpiredOrMalformed(authToken)) {
    // If it's a public path, allow access
    if (isPublicPath) {
      const response = NextResponse.next();
      if (authToken && isJwtExpiredOrMalformed(authToken)) {
        clearAuthCookie(request, response);
      }
      return response;
    }
    // Redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated and trying to access login page, redirect to home
  if (pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Set x-pathname header for route matching in layouts
  const response = NextResponse.next();
  response.headers.set('x-pathname', pathname);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
