import { resolveJwtSecret } from './jwt.strategy';

/**
 * 验签密钥必须与签发侧一致：
 * - admin auth.service.getAdminJwtSecret() = ADMIN_JWT_SECRET || JWT_SECRET || 默认值
 * - auth.module.ts JwtModule = ADMIN_JWT_SECRET || JWT_SECRET || 默认值
 *
 * 曾经的 bug：策略对 type=admin 只读 ADMIN_JWT_SECRET，漏了 JWT_SECRET，
 * 导致只配置 JWT_SECRET 的环境里 admin 登录成功但 /auth/admin/me 等
 * JwtAuthGuard 接口全部 401，前端随即清 token 并跳回登录页。
 */
describe('resolveJwtSecret', () => {
  const originalAdmin = process.env.ADMIN_JWT_SECRET;
  const originalClient = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.ADMIN_JWT_SECRET = originalAdmin;
    process.env.JWT_SECRET = originalClient;
    if (originalAdmin === undefined) delete process.env.ADMIN_JWT_SECRET;
    if (originalClient === undefined) delete process.env.JWT_SECRET;
  });

  it('admin token 优先使用 ADMIN_JWT_SECRET', () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret';
    process.env.JWT_SECRET = 'client-secret';

    expect(resolveJwtSecret({ type: 'admin' })).toBe('admin-secret');
  });

  it('未配置 ADMIN_JWT_SECRET 时 admin token 回退 JWT_SECRET（与签发侧一致）', () => {
    delete process.env.ADMIN_JWT_SECRET;
    process.env.JWT_SECRET = 'client-secret';

    expect(resolveJwtSecret({ type: 'admin' })).toBe('client-secret');
  });

  it('client token 始终使用 JWT_SECRET，即使配置了 ADMIN_JWT_SECRET', () => {
    process.env.ADMIN_JWT_SECRET = 'admin-secret';
    process.env.JWT_SECRET = 'client-secret';

    expect(resolveJwtSecret({ type: 'user' })).toBe('client-secret');
    expect(resolveJwtSecret(undefined)).toBe('client-secret');
    expect(resolveJwtSecret(null)).toBe('client-secret');
  });

  it('两个密钥都未配置时使用默认值', () => {
    delete process.env.ADMIN_JWT_SECRET;
    delete process.env.JWT_SECRET;

    expect(resolveJwtSecret({ type: 'admin' })).toBe(
      'please_change_me_very_secret',
    );
    expect(resolveJwtSecret({ type: 'user' })).toBe(
      'please_change_me_very_secret',
    );
  });
});
