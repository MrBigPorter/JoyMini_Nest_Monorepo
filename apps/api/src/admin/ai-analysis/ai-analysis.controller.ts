import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { AiAnalysisService } from './ai-analysis.service';

class RunAnalysisDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}

@ApiTags('Admin - AI Analysis')
@Controller('admin/ai-analysis')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AiAnalysisController {
  constructor(private readonly service: AiAnalysisService) {}

  @Post('runs')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '跑一个 UTC 日窗口的问题事件与指标（幂等）' })
  run(@Body() dto: RunAnalysisDto, @CurrentUserId() adminId: string) {
    return this.service.runWindow(dto.date, adminId);
  }

  @Get('runs')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: '分析任务运行记录' })
  runs(@Query('limit') limit?: string) {
    return this.service.listRuns(limit ? parseInt(limit, 10) : 20);
  }

  @Get('metrics')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: '指标窗口（默认最近一次完成窗口）' })
  metrics(@Query('date') date?: string) {
    return this.service.listMetrics(date);
  }

  @Get('events')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.EDITOR)
  @ApiOperation({ summary: '标准化问题事件' })
  events(
    @Query('date') date?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listEvents({
      date,
      type,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }
}
