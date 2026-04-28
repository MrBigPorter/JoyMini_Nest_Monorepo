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

  /** GET /v1/client/system-config/locales — 获取已启用的语言列表（公共接口） */
  @Get('locales')
  async getLocales() {
    return this.service.getEnabledLocales();
  }

  /** GET /v1/client/system-config/blog/locales — 获取 blog 已启用的语言列表（公共接口） */
  @Get('blog/locales')
  async getBlogLocales() {
    return this.service.getBlogLocales();
  }
}
