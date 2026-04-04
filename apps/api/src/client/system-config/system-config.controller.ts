import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClientSystemConfigService } from './system-config.service';
import { OptionalJwtAuthGuard } from '@api/common/jwt/option-jwt.guard';

@Controller('client/system-config')
@UseGuards(OptionalJwtAuthGuard) // 可选认证
export class ClientSystemConfigController {
  constructor(private readonly service: ClientSystemConfigService) {}

  /** GET /v1/client/system-config — 获取所有客户端配置 */
  @Get()
  getAll() {
    return this.service.getAll();
  }
}
