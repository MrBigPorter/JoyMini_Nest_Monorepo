import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@lucky/shared';
import { ROLES_KEY } from './roles.decorator';

type UserLike = { role?: unknown };
type RequestLike = { user?: unknown };

const isUserLike = (value: unknown): value is UserLike =>
  typeof value === 'object' && value !== null;

/**
 * RolesGuard — 配合 @Roles() 使用，检查 request.user.role 是否在允许列表中。
 * 前置依赖：AdminJwtAuthGuard 已将 payload 挂到 request.user
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 没有 @Roles() 装饰 → 放行
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    if (!isUserLike(request.user) || typeof request.user.role !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }

    const userRole = request.user.role as Role;

    const hasRole = requiredRoles.includes(userRole);
    if (!hasRole) {
      throw new ForbiddenException(
        `Requires one of: [${requiredRoles.join(', ')}], but user has role: ${userRole}`,
      );
    }

    return true;
  }
}
