import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';

@Controller('admin/stats')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /**
   * GET /v1/admin/stats/overview
   * 总览统计：用户、订单、收入、财务汇总
   */
  @Get('overview')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getOverview() {
    return this.statsService.getOverview();
  }

  /**
   * GET /v1/admin/stats/trend?days=30
   * 趋势数据：最近 N 天的订单量、用户注册量
   */
  @Get('trend')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getTrend(@Query('days') days?: string) {
    const d = days ? parseInt(days, 10) : 30;
    return this.statsService.getTrend(isNaN(d) ? 30 : d);
  }
}
