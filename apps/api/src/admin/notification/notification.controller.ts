import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminNotificationService } from './notification.service';
import { QueryPushLogDto } from './dto/query-push-log.dto';
import { AdminSendBroadcastDto } from './dto/send-broadcast.dto';
import { AdminSendTargetedDto } from './dto/send-targeted.dto';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';
import { CurrentUserId } from '@api/common/decorators/user.decorator';

@Controller('admin/notifications')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AdminNotificationController {
  constructor(private readonly service: AdminNotificationService) {}

  /**
   * GET /v1/admin/notifications/logs
   * 推送历史列表（分页、可按类型/关键词/时间过滤）
   */
  @Get('logs')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  getLogs(@Query() query: QueryPushLogDto) {
    return this.service.getLogs(query);
  }

  /**
   * GET /v1/admin/notifications/devices/stats
   * 设备数统计（按平台分组 + 7天活跃数）
   */
  @Get('devices/stats')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  getDeviceStats() {
    return this.service.getDeviceStats();
  }

  /**
   * POST /v1/admin/notifications/broadcast
   * 全员广播推送
   */
  @Post('broadcast')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async sendBroadcast(
    @Body() dto: AdminSendBroadcastDto,
    @CurrentUserId() adminId: string,
  ) {
    return this.service.sendBroadcast(dto, adminId);
  }

  /**
   * POST /v1/admin/notifications/targeted
   * 向指定用户推送
   */
  @Post('targeted')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async sendTargeted(
    @Body() dto: AdminSendTargetedDto,
    @CurrentUserId() adminId: string,
  ) {
    return this.service.sendTargeted(dto, adminId);
  }
}
