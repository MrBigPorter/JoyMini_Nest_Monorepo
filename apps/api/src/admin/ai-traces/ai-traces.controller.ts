import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TraceService } from './ai-traces.service';
import { QueryTraceDto } from './dto/query-trace.dto';

@ApiTags('Admin - AI Traces')
@Controller('admin/ai-traces')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiTracesController {
  constructor(private readonly traces: TraceService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'AI 回复链路列表（只读）' })
  async list(@Query() query: QueryTraceDto) {
    return this.traces.list(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'AI 回复链路详情（含 spans）' })
  async get(@Param('id') id: string) {
    return this.traces.get(id);
  }
}
