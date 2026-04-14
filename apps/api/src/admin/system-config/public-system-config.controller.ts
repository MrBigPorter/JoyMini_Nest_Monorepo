import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';

interface LocaleConfig {
  code: string;
  name: string;
  nativeName: string;
  enabled: boolean;
  isDefault: boolean;
}

interface LocalesResponse {
  list: LocaleConfig[];
}

@ApiTags('system-config')
@Controller('v1/client/system-config')
export class PublicSystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get('locales')
  @ApiOperation({ summary: '获取已启用的语言列表' })
  @ApiResponse({
    status: 200,
    description: '返回已启用的语言列表',
    schema: {
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'zh' },
              name: { type: 'string', example: '中文' },
              nativeName: { type: 'string', example: '简体中文' },
              enabled: { type: 'boolean', example: true },
              isDefault: { type: 'boolean', example: true },
            },
          },
        },
      },
    },
  })
  async getEnabledLocales(): Promise<LocalesResponse> {
    const locales = await this.systemConfigService.getEnabledLocales();
    return locales;
  }
}
