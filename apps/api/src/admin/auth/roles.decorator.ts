import { SetMetadata } from '@nestjs/common';
import { Role } from '@lucky/shared';

export const ROLES_KEY = 'roles';

/**
 * Roles decorator — 标注允许访问的角色
 * @example @Roles(Role.SUPER_ADMIN, Role.ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
