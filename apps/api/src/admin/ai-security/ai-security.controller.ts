import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AiSecurityService } from './ai-security.service';
import { QuerySecurityEventsDto } from './dto/query-security.dto';
import { UpdateSecurityEventDto } from './dto/update-security-event.dto';


interface AdminRequest extends Request {
  user?: { userId?: string };
}

const CurrentAdminId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    return req.user?.userId ?? 'admin';
  },
);

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

  @Patch('events/:id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '安全事件处置（确认/误报/拦截）' })
  async triage(
    @Param('id') id: string,
    @Body() dto: UpdateSecurityEventDto,
    @CurrentAdminId() adminId: string,
  ) {
    return this.security.triage(id, dto, adminId);
  }

  @Get('summary')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '注入检测汇总' })
  async summary(@Query() query: QuerySecurityEventsDto) {
    return this.security.summary(query);
  }
}
