import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JwtAuthGuard — JWT 认证守卫
 *
 * 支持测试 Token 旁路（仅非生产环境）：
 * 若请求头 Authorization: Bearer <JWT_TEST_TOKEN> 匹配环境变量，
 * 则跳过 JWT 签名验证，通过以下方式确定用户身份（优先级从高到低）：
 *
 *   1. Token 内嵌：Bearer <JWT_TEST_TOKEN>|<userId>     ← 从 '|' 后面解析
 *   2. 请求头：   X-Test-User-Id: <userId>                ← 从 header 读取
 *   3. 环境变量： JWT_TEST_USER_ID                         ← fallback
 *
 * 使用场景：
 * - 开发/测试环境免登录调用受保护的 API
 * - LLM 自动化测试：每次请求传不同的 userId 模拟不同用户
 * - Postman/curl 快速调试：一行命令切换用户
 *
 * 安全说明：
 * - NODE_ENV=production 时禁用测试 Token 旁路
 * - 不设置 JWT_TEST_TOKEN 时行为完全不变
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;
    const testToken = process.env.JWT_TEST_TOKEN;

    // 测试 Token 旁路：仅在非生产环境且配置了 JWT_TEST_TOKEN 时生效
    if (testToken && process.env.NODE_ENV !== 'production') {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return super.canActivate(context) as boolean | Promise<boolean>;
      }

      const rawToken = authHeader.slice(7); // 去掉 'Bearer '

      // ── 方式 1：Token 内嵌 userId ──
      // Authorization: Bearer <JWT_TEST_TOKEN>|<userId>
      const pipeIndex = rawToken.indexOf('|');
      if (pipeIndex !== -1) {
        const tokenPart = rawToken.slice(0, pipeIndex);
        const userIdPart = rawToken.slice(pipeIndex + 1);

        if (tokenPart === testToken && userIdPart) {
          request.user = {
            id: userIdPart,
            userId: userIdPart,
            role: '',
            type: 'test',
          };
          return true;
        }
      }

      // ── 方式 2：精确匹配 JWT_TEST_TOKEN ──
      // 然后从 X-Test-User-Id header 或 JWT_TEST_USER_ID 取 userId
      if (rawToken === testToken) {
        const testUserId =
          request.headers['x-test-user-id'] || process.env.JWT_TEST_USER_ID;

        if (!testUserId) {
          throw new UnauthorizedException(
            'X-Test-User-Id header or JWT_TEST_USER_ID env required when using test token',
          );
        }

        request.user = {
          id: testUserId,
          userId: testUserId,
          role: '',
          type: 'test',
        };
        return true;
      }
    }

    // 不走旁路：走标准 Passport JWT 验证流程
    return super.canActivate(context) as boolean | Promise<boolean>;
  }
}
