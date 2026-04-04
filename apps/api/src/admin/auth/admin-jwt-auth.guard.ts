import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

type AdminJwtPayload = {
  sub?: string;
  role?: string;
  type?: string;
  username?: string;
};

type RequestLike = {
  headers?: Record<string, unknown>;
  user?: {
    id: string;
    userId: string;
    role: string;
    type: string;
    username: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStringOrEmpty = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * Admin JWT Auth Guard
 * 验证 Admin token（用 ADMIN_JWT_SECRET 或 JWT_SECRET 签发）
 * 不注入 JwtService，直接使用 jsonwebtoken，避免每个模块都要 import JwtModule
 */
@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No admin token provided');
    }

    const secret =
      process.env.ADMIN_JWT_SECRET ||
      process.env.JWT_SECRET ||
      'please_change_me_very_secret';

    try {
      const payloadUnknown: unknown = jwt.verify(token, secret);
      const payload: AdminJwtPayload = isRecord(payloadUnknown)
        ? payloadUnknown
        : {};

      const sub = toStringOrEmpty(payload.sub);
      // 挂载到 request.user，供 @CurrentUserId 等 decorator 使用
      request.user = {
        id: sub,
        userId: sub,
        role: toStringOrEmpty(payload.role),
        type: toStringOrEmpty(payload.type),
        username: toStringOrEmpty(payload.username),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired admin token');
    }

    return true;
  }

  private extractToken(request: RequestLike): string | null {
    const authHeader = request.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return null;
  }
}
