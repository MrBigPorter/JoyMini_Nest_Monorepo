import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeviceSecurityService } from '@api/common/device/device-security.service';
import {
  DEVICE_SECURITY_KEY,
  DeviceSecurityLevel,
} from '@api/common/decorators/device-security.decorator';
import {
  getDeviceId,
  getDeviceModel,
  getRealIp,
  getUserAgent,
} from '@api/common/utils/request.util';
import type { Request } from 'express';

const extractUserId = (request: Request): string | null => {
  const reqWithUser = request as unknown as { user?: unknown };
  if (!reqWithUser.user || typeof reqWithUser.user !== 'object') {
    return null;
  }

  const rawId = (reqWithUser.user as Record<string, unknown>).id;
  return typeof rawId === 'string' ? rawId : null;
};

@Injectable()
export class DeviceSecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly deviceSecurityService: DeviceSecurityService,
  ) {}

  /**
   * 执行守卫逻辑
   * @param context
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 读装饰器配置
    const level = this.reflector.getAllAndOverride<DeviceSecurityLevel>(
      DEVICE_SECURITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!level) {
      return true; // 没加装饰器，放行
    }

    // 2. 拿 User (必须在 JwtAuthGuard 后)
    const request = context.switchToHttp().getRequest<Request>();
    const userId = extractUserId(request);
    if (!userId) {
      throw new UnauthorizedException();
    }

    // 3. 提取指纹
    const deviceInfo = {
      ip: getRealIp(request),
      deviceId: getDeviceId(request),
      deviceModel: getDeviceModel(request),
      userAgent: getUserAgent(request),
    };

    // 4. 执行风控
    await this.deviceSecurityService.validateAndLogDevice(userId, deviceInfo);

    // 5. 严格模式额外检查
    if (level === DeviceSecurityLevel.STRICT_CHECK) {
      await this.deviceSecurityService.checkWithdrawEligibility(
        userId,
        deviceInfo.deviceId,
      );
    }
    return true;
  }
}
