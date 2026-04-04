import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function createJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${payload}.sig`;
}

describe('middleware auth guard', () => {
  it('no token on protected page should redirect to /login', () => {
    const req = new NextRequest('http://localhost/orders');
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login');
  });

  it('valid cookie token on /login should redirect to /', () => {
    const token = createJwt(Math.floor(Date.now() / 1000) + 3600);
    const req = new NextRequest('http://localhost/login', {
      headers: { cookie: `auth_token=${token}` },
    });
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/');
  });

  it('expired cookie token on /login should pass through and clear cookie', () => {
    const token = createJwt(Math.floor(Date.now() / 1000) - 3600);
    const req = new NextRequest('http://localhost/login', {
      headers: { cookie: `auth_token=${token}` },
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('auth_token=;');
    expect(setCookie).toContain('Max-Age=0');
  });

  it('x-auth-token header alone should not be treated as authenticated', () => {
    const token = createJwt(Math.floor(Date.now() / 1000) + 3600);
    const req = new NextRequest('http://localhost/login', {
      headers: { 'x-auth-token': token },
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('invalid token on /login should pass through and clear cookie', () => {
    const token = createJwt(Math.floor(Date.now() / 1000) - 3600);
    const req = new NextRequest('http://localhost/login', {
      headers: { cookie: `auth_token=${token}` },
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('auth_token=;');
    expect(setCookie).toContain('Max-Age=0');
  });

  it('invalid token on joyminis subdomain /login should clear parent-domain cookie', () => {
    const token = createJwt(Math.floor(Date.now() / 1000) - 3600);
    const req = new NextRequest('https://admin-dev.joyminis.com/login', {
      headers: { cookie: `auth_token=${token}` },
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('auth_token=;');
    expect(setCookie).toContain('Domain=.joyminis.com');
  });
});
