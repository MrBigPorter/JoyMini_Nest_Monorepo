import { Controller, Get, Patch, Delete, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@lucky/shared';
import {
  QueueMonitorService,
  QueueMonitoringResponse,
} from '@api/common/queue/queue-monitor.service';

@ApiTags('Admin - Queue Monitor')
@Controller('admin/queues')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class QueueMonitorController {
  constructor(private readonly queueMonitorService: QueueMonitorService) {}

  @Get()
  @ApiOperation({ summary: '获取所有队列状态和统计信息' })
  @ApiResponse({ status: 200, description: '队列状态信息' })
  async getQueueStats(): Promise<QueueMonitoringResponse> {
    return this.queueMonitorService.getQueueStats();
  }

  @Patch('pause')
  @ApiOperation({ summary: '暂停指定队列' })
  @ApiResponse({ status: 200, description: '队列已暂停' })
  async pauseQueue(@Body() body: { queueName: string }) {
    const success = await this.queueMonitorService.pauseQueue(body.queueName);
    return {
      success,
      message: success ? 'Queue paused' : 'Failed to pause queue',
    };
  }

  @Patch('resume')
  @ApiOperation({ summary: '恢复指定队列' })
  @ApiResponse({ status: 200, description: '队列已恢复' })
  async resumeQueue(@Body() body: { queueName: string }) {
    const success = await this.queueMonitorService.resumeQueue(body.queueName);
    return {
      success,
      message: success ? 'Queue resumed' : 'Failed to resume queue',
    };
  }

  @Delete('clean')
  @ApiOperation({ summary: '清理队列中的旧任务' })
  @ApiResponse({ status: 200, description: '清理完成' })
  async cleanQueue(
    @Query('queueName') queueName: string,
    @Query('grace') grace: string = '86400000', // 默认24小时
  ) {
    const graceMs = parseInt(grace, 10);
    const cleanedCount = await this.queueMonitorService.cleanQueue(
      queueName,
      graceMs,
    );
    return {
      success: true,
      message: `Cleaned ${cleanedCount} jobs from queue ${queueName}`,
      cleanedCount,
    };
  }

  @Get('blog-ai/translation-stats')
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
