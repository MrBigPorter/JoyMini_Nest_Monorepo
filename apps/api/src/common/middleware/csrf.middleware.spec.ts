import { ForbiddenException } from '@nestjs/common';
import { CsrfMiddleware } from './csrf.middleware';

function run(req: any) {
  const next = jest.fn();
  const middleware = new CsrfMiddleware();
  try {
    middleware.use(req, {} as any, next);
    return { next, error: null };
  } catch (error) {
    return { next, error };
  }
}

describe('CsrfMiddleware', () => {
  it('OTP 登录前接口跳过 CSRF', () => {
    const { next, error } = run({
      method: 'POST',
      path: '/api/v1/otp/request',
      headers: {},
    });
    expect(error).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('auth 接口继续跳过 CSRF', () => {
    const { next, error } = run({
      method: 'POST',
      path: '/api/v1/auth/login/otp',
      headers: {},
    });
    expect(error).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('普通写接口缺少 token 时拒绝', () => {
    const { error } = run({
      method: 'POST',
      path: '/api/v1/orders',
      headers: {},
      cookies: {},
    });
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('cookie 与 header 一致时放行', () => {
    const token = 'a'.repeat(64);
    const { next, error } = run({
      method: 'POST',
      path: '/api/v1/orders',
      headers: { 'x-csrf-token': token },
      cookies: { csrf_token: token },
    });
    expect(error).toBeNull();
    expect(next).toHaveBeenCalled();
  });
});
