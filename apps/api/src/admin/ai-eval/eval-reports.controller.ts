import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EvalReportsService } from './eval-reports.service';

@ApiTags('Admin - AI Eval Reports')
@Controller('admin/ai-eval/reports')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class EvalReportsController {
  constructor(private readonly service: EvalReportsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '最近的多轮评测报告（只读）' })
  list(@Query('limit') limit?: string) {
    return this.service.list(limit ? parseInt(limit, 10) : 20);
  }

  @Get('latest')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '最新一份评测报告' })
  latest() {
    return this.service.latest();
  }
}
