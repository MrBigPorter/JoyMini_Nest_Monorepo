import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * OptionalJwtAuthGuard — 可选的 JWT 认证守卫
 *
 * 与 JwtAuthGuard 的区别：
 * - JwtAuthGuard：Token 无效/缺失 → 抛出 401
 * - OptionalJwtAuthGuard：Token 无效/缺失 → 返回 null（允许请求通过，userId 为 null）
 *
 * 适用于"登录可看更多，不登录也能看"的场景。
 *
 * 同样支持测试 Token 旁路（与 JwtAuthGuard 逻辑一致）：
 *   1. Token 内嵌：Bearer <JWT_TEST_TOKEN>|<userId>
 *   2. 请求头：   X-Test-User-Id: <userId>
 *   3. 环境变量： JWT_TEST_USER_ID
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;
    const testToken = process.env.JWT_TEST_TOKEN;

    // 测试 Token 旁路
    if (testToken && process.env.NODE_ENV !== 'production') {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const rawToken = authHeader.slice(7);

        // 方式 1：Token 内嵌 userId
        const pipeIndex = rawToken.indexOf('|');
        if (pipeIndex !== -1) {
          const tokenPart = rawToken.slice(0, pipeIndex);
          const userIdPart = rawToken.slice(pipeIndex + 1);
          if (tokenPart === testToken && userIdPart) {
            request.user = { id: userIdPart, userId: userIdPart, role: '', type: 'test' };
            return true;
          }
        }

        // 方式 2：精确匹配 + header
        if (rawToken === testToken) {
          const testUserId =
            request.headers['x-test-user-id'] || process.env.JWT_TEST_USER_ID;
          if (testUserId) {
            request.user = { id: testUserId, userId: testUserId, role: '', type: 'test' };
            return true;
          }
        }
      }
    }

    // 不走旁路：走标准 Passport JWT 验证流程
    return super.canActivate(context) as boolean | Promise<boolean>;
  }

  /**
   * 重写 handleRequest 方法
   * 默认行为是：如果有 err 或 !user，直接抛出 UnauthorizedException。
   * 我们改为：如果有 err 或 !user，返回 null，允许请求通过。
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser | null {
    void info;
    void context;
    void status;
    // 如果验证出错了，或者没解析出用户（比如没带 Token），直接返回 null
    if (err || !user) {
      return null;
    }

    // 如果验证成功，返回 user 对象，后续 Controller 里的 @CurrentUserId 就能拿到了
    return user;
  }
}
