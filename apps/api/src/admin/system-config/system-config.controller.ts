import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

@Controller('admin/system-config')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class SystemConfigController {
  constructor(private readonly service: SystemConfigService) {}

  /** GET /v1/admin/system-config — 全部配置项 */
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  getAll() {
    return this.service.getAll();
  }

  /** POST /v1/admin/system-config — 创建新配置 */
  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  create(@Body() dto: CreateSystemConfigDto) {
    return this.service.create(dto);
  }

  /** PATCH /v1/admin/system-config/:key — 更新单项 */
  @Patch(':key')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  update(@Param('key') key: string, @Body() dto: UpdateSystemConfigDto) {
    return this.service.update(key, dto);
  }

  /** DELETE /v1/admin/system-config/:key — 删除配置 */
  @Delete(':key')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  delete(@Param('key') key: string) {
    return this.service.delete(key);
  }

  /**
   * GET /v1/admin/system-config/locales
   * 获取所有语言列表及启用状态
   */
  @Get('locales')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  getLocales() {
    return this.service.getEnabledLocales();
  }

  /**
   * PATCH /v1/admin/system-config/locales/:code
   * 切换指定语言的启用状态
   */
  @Patch('locales/:code')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  toggleLocale(
    @Param('code') code: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.service.toggleLocale(code, body.enabled);
  }

  /**
   * GET /v1/admin/system-config/translation/default-source-lang
   * 获取当前默认源语言配置
   */
  @Get('translation/default-source-lang')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getDefaultSourceLang() {
    const code = await this.service.get<string>(
      'blog.translation.defaultSourceLang',
      'zh',
    );

    const locales = await this.service.getEnabledLocales();
    const locale = locales.list.find((l) => l.code === code);

    return {
      code,
      name: locale?.name || code,
      nativeName: locale?.nativeName || code,
    };
  }

  /**
   * PATCH /v1/admin/system-config/translation/default-source-lang
   * 更新默认源语言配置
   */
  @Patch('translation/default-source-lang')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateDefaultSourceLang(@Body() body: { code: string }) {
    await this.service.update('blog.translation.defaultSourceLang', {
      value: JSON.stringify(body.code),
    });

    return { success: true };
  }

  /**
   * GET /v1/admin/system-config/blog/locales
   * 获取 blog 已启用的语言列表（独立于 admin-next）
   */
  @Get('blog/locales')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  getBlogLocales() {
    return this.service.getBlogLocales();
  }

  /**
   * PATCH /v1/admin/system-config/blog/locales/:code
   * 切换 blog 指定语言的启用状态（独立于 admin-next）
   */
  @Patch('blog/locales/:code')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  toggleBlogLocale(
    @Param('code') code: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.service.toggleBlogLocale(code, body.enabled);
  }
}
