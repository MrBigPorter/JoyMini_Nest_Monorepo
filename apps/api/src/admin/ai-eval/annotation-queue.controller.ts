import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@lucky/shared';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { AnnotationQueueService } from './annotation-queue.service';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@ApiTags('Admin - AI Annotation Queue')
@Controller('admin/ai-eval/annotations')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class AnnotationQueueController {
  constructor(private readonly service: AnnotationQueueService) {}

  @Get('queue')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '当前管理员的标注队列' })
  queue(
    @CurrentUserId() adminId: string,
    @Query('status') status?: string,
    @Query('worksheet') worksheet?: string,
  ) {
    const normalized =
      status === 'pending' || status === 'done' ? status : 'all';
    return this.service.queue(adminId, normalized, worksheet);
  }

  @Get('worksheets')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '可选的标注工作表列表' })
  async worksheets() {
    return { worksheets: await this.service.listWorksheets() };
  }

  @Get('export')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '导出当前管理员的已标注 JSONL（兼容离线脚本）' })
  async export(
    @CurrentUserId() adminId: string,
    @Query('worksheet') worksheet?: string,
  ) {
    return { jsonl: await this.service.exportJsonl(adminId, worksheet) };
  }

  @Patch(':caseId/:turn')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '保存一条人工标注' })
  save(
    @CurrentUserId() adminId: string,
    @Param('caseId') caseId: string,
    @Param('turn', ParseIntPipe) turn: number,
    @Body() dto: UpdateAnnotationDto,
    @Query('worksheet') worksheet?: string,
  ) {
    return this.service.save(
      adminId,
      caseId,
      turn,
      {
        correctness: dto.correctness ?? null,
        comment: dto.comment ?? '',
      },
      { worksheet, guidelineVersion: dto.guidelineVersion },
    );
  }
}
