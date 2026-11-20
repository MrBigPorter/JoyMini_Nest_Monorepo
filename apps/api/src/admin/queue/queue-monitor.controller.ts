import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AdminJwtAuthGuard } from '../auth/admin-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '@lucky/shared';
import {
  QueueMonitorService,
  QueueMonitoringResponse,
} from '@api/common/queue/queue-monitor.service';
import { AiTaskOutboxService } from '@api/common/queue/ai-task-outbox.service';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { OperationLogService } from '../operation-log/operation-log.service';
import { QueueActionDto } from './dto/queue-action.dto';

@ApiTags('Admin - Queue Monitor')
@Controller('admin/queues')
@UseGuards(AdminJwtAuthGuard, RolesGuard)
export class QueueMonitorController {
  private readonly logger = new Logger(QueueMonitorController.name);

  constructor(
    private readonly queueMonitorService: QueueMonitorService,
    private readonly aiTaskOutboxService: AiTaskOutboxService,
    private readonly operationLog: OperationLogService,
  ) {}

  private writeLog(adminId: string, action: string, details: string) {
    void this.operationLog.log({
      adminId,
      adminName: adminId,
      module: 'ai-queues',
      action,
      details,
    });
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '获取所有队列状态和统计信息' })
  @ApiResponse({ status: 200, description: '队列状态信息' })
  async getQueueStats(): Promise<QueueMonitoringResponse> {
    return this.queueMonitorService.getQueueStats();
  }

  @Patch('pause')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '暂停指定队列' })
  @ApiResponse({ status: 200, description: '队列已暂停' })
  async pauseQueue(
    @Body() body: QueueActionDto,
    @CurrentUserId() adminId: string,
  ) {
    const success = await this.queueMonitorService.pauseQueue(body.queueName);
    if (success) this.writeLog(adminId, 'pause', body.queueName);
    return {
      success,
      message: success ? 'Queue paused' : 'Failed to pause queue',
    };
  }

  @Patch('resume')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '恢复指定队列' })
  @ApiResponse({ status: 200, description: '队列已恢复' })
  async resumeQueue(
    @Body() body: QueueActionDto,
    @CurrentUserId() adminId: string,
  ) {
    const success = await this.queueMonitorService.resumeQueue(body.queueName);
    if (success) this.writeLog(adminId, 'resume', body.queueName);
    return {
      success,
      message: success ? 'Queue resumed' : 'Failed to resume queue',
    };
  }

  @Delete('clean')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '清理队列中的旧任务' })
  @ApiResponse({ status: 200, description: '清理完成' })
  async cleanQueue(
    @Query() query: QueueActionDto,
    @CurrentUserId() adminId: string,
  ) {
    const graceMs = query.grace ?? 86_400_000;
    const includeFailed = query.includeFailed === true;
    try {
      const { cleanedCount, failedCleanedCount } =
        await this.queueMonitorService.cleanQueue(
          query.queueName,
          graceMs,
          includeFailed,
        );
      this.writeLog(
        adminId,
        'clean',
        `${query.queueName}, grace=${graceMs}, includeFailed=${includeFailed}`,
      );
      return {
        success: true,
        message:
          `Cleaned ${cleanedCount} completed` +
          (includeFailed ? ` and ${failedCleanedCount} failed` : '') +
          ` jobs from queue ${query.queueName}`,
        cleanedCount,
        failedCleanedCount,
        includeFailed,
      };
    } catch (error: any) {
      this.logger.error(
        `[QueueMonitor] clean failed for ${query.queueName}: ${
          error?.message ?? error
        }`,
      );
      return {
        success: false,
        message: `Failed to clean queue ${query.queueName}`,
      };
    }
  }

  @Get('ai/failed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'AI 队列死信列表' })
  async getAiFailedJobs(@Query('limit') limit: string = '50') {
    return this.queueMonitorService.getAiFailedJobs(parseInt(limit, 10) || 50);
  }

  @Post('ai/:messageId/replay')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '按 messageId 重放 AI 死信' })
  async replayAiJob(
    @Param('messageId') messageId: string,
    @CurrentUserId() adminId: string,
  ) {
    const result = await this.queueMonitorService.replayAiJob(messageId);
    if (result.ok) this.writeLog(adminId, 'replay-ai', messageId);
    return result;
  }

  @Get('ai/outbox')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: 'AI 任务 Outbox 列表（可按状态筛选）' })
  async getAiOutbox(
    @Query('status') status?: string,
    @Query('limit') limit: string = '50',
  ) {
    return this.aiTaskOutboxService.list(status, parseInt(limit, 10) || 50);
  }

  @Get('ai/outbox-failed')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '入队失败（Outbox FAILED）的任务' })
  async getAiOutboxFailures(@Query('limit') limit: string = '50') {
    return this.aiTaskOutboxService.listFailed(parseInt(limit, 10) || 50);
  }

  @Post('ai/outbox/:messageId/replay')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: '重放 Outbox 入队失败任务' })
  async replayAiOutbox(
    @Param('messageId') messageId: string,
    @CurrentUserId() adminId: string,
  ) {
    const ok = await this.aiTaskOutboxService.replayFailed(messageId);
    if (ok) this.writeLog(adminId, 'replay-outbox', messageId);
    return { ok, reason: ok ? undefined : 'not_failed_or_missing' };
  }

  @Get('blog-ai/translation-stats')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.VIEWER)
  @ApiOperation({ summary: '获取博客AI翻译队列的详细统计' })
  @ApiResponse({ status: 200, description: '翻译队列统计信息' })
  async getBlogAiTranslationStats() {
    const stats = await this.queueMonitorService.getQueueStats();
    const blogAiQueue = stats.queues.find((q) => q.name === 'blog-ai');
    const blogAiJobs = stats.jobStats['blog-ai'] || [];
    const translationJobs = blogAiJobs.find(
      (j) => j.type === 'translate-article',
    );

    return {
      queue: blogAiQueue,
      translationStats: translationJobs,
      timestamp: stats.timestamp,
      system: stats.system,
    };
  }
}
