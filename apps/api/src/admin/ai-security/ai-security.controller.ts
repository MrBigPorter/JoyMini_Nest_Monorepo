import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiSecurityService } from './ai-security.service';
import { QuerySecurityEventsDto } from './dto/query-security.dto';

@ApiTags('Admin - AI Security')
@Controller('admin/ai-security')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiSecurityController {
  constructor(private readonly security: AiSecurityService) {}

  @Get('events')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '注入检测命中列表（不返回原文）' })
  async list(@Query() query: QuerySecurityEventsDto) {
    return this.security.list(query);
  }

  @Get('summary')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '注入检测汇总' })
  async summary(@Query() query: QuerySecurityEventsDto) {
    return this.security.summary(query);
  }
}
