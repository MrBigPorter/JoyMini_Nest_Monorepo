import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiInsightsService } from './ai-insights.service';
import { QueryInsightsDto } from './dto/query-insights.dto';

@ApiTags('Admin - AI Insights')
@Controller('admin/ai-insights')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiInsightsController {
  constructor(private readonly insights: AiInsightsService) {}

  @Get('overview')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'AI 对话运营指标' })
  async overview(@Query() query: QueryInsightsDto) {
    return this.insights.overview(query);
  }
}
