import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
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
