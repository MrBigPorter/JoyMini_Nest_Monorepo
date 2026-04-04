import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, RolePermissions } from '@lucky/shared';
import { PERMISSION_KEY } from '@api/common/decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. 获取路由上的 @RequirePermission 标签内容 (格式如 'marketing:create')
    const requiredPermission = this.reflector.get<string>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    //  如果没加 @RequirePermission 标签，说明不需要特定权限，直接放行
    if (!requiredPermission) {
      return true;
    }

    //  获取 Request 对象（JwtAuthGuard 已经把 user 挂载上去了)
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: Role } }>();
    const user = request.user;
    const role = user?.role;

    //  防御性检查：确保用户已登录且身份有效
    if (!user || !role) {
      throw new UnauthorizedException('unauthorized');
    }

    console.log(
      `Checking permission "${requiredPermission}" for role "${role}"`,
    );
    // 5. 超级管理员跳过所有检查
    if (role === Role.SUPER_ADMIN) {
      return true;
    }

    //  核心逻辑：查配置表
    // 根据用户的 Role，拿到他所有的权限列表
    // 例如：user.role 是 'EDITOR'，这里就拿到运营的所有权限数组
    const userPermissions = RolePermissions[role] ?? [];

    // 7. 检查用户是否拥有当前接口所需的权限
    const hasPermission = userPermissions.includes(requiredPermission);

    if (!hasPermission) {
      throw new ForbiddenException(`no permission: ${requiredPermission}`);
    }

    return true;
  }
}
