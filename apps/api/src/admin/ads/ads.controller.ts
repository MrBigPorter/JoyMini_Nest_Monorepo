import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdsService } from './ads.service';
import { QueryAdsDto } from './dto/query-ads.dto';
import { CreateAdDto, UpdateAdDto } from './dto/create-update-ad.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

@Controller('admin/ads')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdsController {
  constructor(private readonly service: AdsService) {}

  /** GET /v1/admin/ads — 广告列表 */
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR, Role.VIEWER)
  getList(@Query() query: QueryAdsDto) {
    return this.service.getList(query);
  }

  /** POST /v1/admin/ads — 创建广告 */
  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  create(@Body() dto: CreateAdDto) {
    return this.service.create(dto);
  }

  /** PATCH /v1/admin/ads/:id — 更新广告 */
  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  update(@Param('id') id: string, @Body() dto: UpdateAdDto) {
    return this.service.update(id, dto);
  }

  /** PATCH /v1/admin/ads/:id/toggle-status — 切换状态 */
  @Patch(':id/toggle-status')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }

  /** DELETE /v1/admin/ads/:id — 删除广告 */
  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
