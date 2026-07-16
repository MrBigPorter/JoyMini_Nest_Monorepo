import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';

/**
 * SSE JWT 认证守卫
 *
 * 继承标准 JwtAuthGuard，额外支持从查询参数 ?token= 读取 JWT。
 *
 * 为什么需要这个？
 *   EventSource 和 dart:io HttpClient 无法在 GET 请求中设置 Authorization header。
 *   Admin 端的 AdminJwtAuthGuard 已有同样的 `?token=` 回退逻辑。
 *
 * 使用方式：
 *   GET /api/v1/ai/customer/chat/stream/:streamId?token=<jwt>
 *
 * 安全问题：
 *   - Token 在 URL 里会被浏览器历史、Nginx 日志记录
 *   - 仅用于 SSE 端点，不扩展到其他接口
 *   - 生产环境应使用 HTTPS 防止中间人截获
 */
@Injectable()
export class SseJwtAuthGuard extends JwtAuthGuard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // SSE 回退：没有 Authorization header 时从 ?token= 查询参数取
    if (!request.headers.authorization) {
      const queryToken = request.query?.token;
      if (typeof queryToken === 'string' && queryToken.length > 0) {
        request.headers.authorization = `Bearer ${queryToken}`;
      }
    }

    return super.canActivate(context);
  }
}
