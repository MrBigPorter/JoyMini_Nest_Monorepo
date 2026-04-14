import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
  isPaused: boolean;
  rateLimit?: {
    max: number;
    duration: number;
  };
}

export interface JobStats {
  type: string;
  count: number;
  lastCompleted?: Date;
  lastFailed?: Date;
  avgProcessingTime?: number;
}

export interface QueueMonitoringResponse {
  queues: QueueStats[];
  jobStats: Record<string, JobStats[]>;
  timestamp: Date;
  totalJobs: number;
  system: {
    redisConnected: boolean;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
}

@Injectable()
export class QueueMonitorService {
  private readonly logger = new Logger(QueueMonitorService.name);
  private readonly queueNames = ['blog-ai', 'avatar', 'group_settlement'];

  constructor(
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
    @InjectQueue('avatar') private avatarQueue: Queue,
    @InjectQueue('group_settlement') private settlementQueue: Queue,
    private configService: ConfigService,
  ) {}

  async getQueueStats(): Promise<QueueMonitoringResponse> {
    const queuePromises = this.queueNames.map(async (queueName) => {
      return this.getQueueStatsByName(queueName);
    });

    const queues = await Promise.all(queuePromises);
    const jobStats = await this.getJobStats();
    const totalJobs = queues.reduce((sum, queue) => sum + queue.total, 0);

    return {
      queues,
      jobStats,
      timestamp: new Date(),
      totalJobs,
      system: await this.getSystemStats(),
    };
  }

  private async getQueueStatsByName(queueName: string): Promise<QueueStats> {
    let queue: Queue;
    switch (queueName) {
      case 'blog-ai':
        queue = this.blogAiQueue;
        break;
      case 'avatar':
        queue = this.avatarQueue;
        break;
      case 'group_settlement':
        queue = this.settlementQueue;
        break;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      // Note: getPausedCount doesn't exist in BullMQ, we'll use isPaused instead
      const isPaused = await queue.isPaused();
      const paused = isPaused ? waiting + active + delayed : 0; // Estimate paused jobs
      const total = waiting + active + completed + failed + delayed;

      // Get rate limit config for blog-ai queue
      let rateLimit;
      if (queueName === 'blog-ai') {
        rateLimit = {
          max: 15, // Google免费配额 15 RPM
          duration: 60000, // 1分钟
        };
      }

      return {
        name: queueName,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused,
        total,
        isPaused,
        rateLimit,
      };
    } catch (error) {
      this.logger.error(`Failed to get stats for queue ${queueName}:`, error);
      return {
        name: queueName,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
        total: 0,
        isPaused: false,
      };
    }
  }

  private async getJobStats(): Promise<Record<string, JobStats[]>> {
    const result: Record<string, JobStats[]> = {};

    // Get job stats for blog-ai queue
    const blogAiJobs = await this.getBlogAiJobStats();
    result['blog-ai'] = blogAiJobs;

    // Get job stats for avatar queue
    const avatarJobs = await this.getAvatarJobStats();
    result['avatar'] = avatarJobs;

    // Get job stats for settlement queue
    const settlementJobs = await this.getSettlementJobStats();
    result['group_settlement'] = settlementJobs;

    return result;
  }

  private async getBlogAiJobStats(): Promise<JobStats[]> {
    try {
      const jobTypes = ['translate-article', 'moderate-comment', 'auto-reply'];
      const stats: JobStats[] = [];

      for (const jobType of jobTypes) {
        const jobs = await this.blogAiQueue.getJobs(['completed', 'failed']);
        const filteredJobs = jobs.filter((job) => job.name === jobType);

        if (filteredJobs.length > 0) {
          const completedJobs = filteredJobs.filter((job) => job.finishedOn);
          const failedJobs = filteredJobs.filter((job) => job.failedReason);

          const lastCompleted =
            completedJobs.length > 0
              ? new Date(
                  Math.max(...completedJobs.map((j) => j.finishedOn || 0)),
                )
              : undefined;

          const lastFailed =
            failedJobs.length > 0
              ? new Date(Math.max(...failedJobs.map((j) => j.finishedOn || 0)))
              : undefined;

          // Calculate average processing time
          let avgProcessingTime;
          if (completedJobs.length > 0) {
            const totalTime = completedJobs.reduce((sum, job) => {
              if (job.processedOn && job.finishedOn) {
                return sum + (job.finishedOn - job.processedOn);
              }
              return sum;
            }, 0);
            avgProcessingTime = totalTime / completedJobs.length;
          }

          stats.push({
            type: jobType,
            count: filteredJobs.length,
            lastCompleted,
            lastFailed,
            avgProcessingTime,
          });
        } else {
          stats.push({
            type: jobType,
            count: 0,
          });
        }
      }

      return stats;
    } catch (error) {
      this.logger.error('Failed to get blog-ai job stats:', error);
      return [];
    }
  }

  private async getAvatarJobStats(): Promise<JobStats[]> {
    try {
      const jobs = await this.avatarQueue.getJobs(['completed', 'failed']);

      return [
        {
          type: 'generate-avatar',
          count: jobs.length,
          lastCompleted:
            jobs.length > 0
              ? new Date(
                  Math.max(
                    ...jobs
                      .filter((j) => j.finishedOn)
                      .map((j) => j.finishedOn || 0),
                  ),
                )
              : undefined,
          lastFailed:
            jobs.length > 0
              ? new Date(
                  Math.max(
                    ...jobs
                      .filter((j) => j.failedReason)
                      .map((j) => j.finishedOn || 0),
                  ),
                )
              : undefined,
        },
      ];
    } catch (error) {
      this.logger.error('Failed to get avatar job stats:', error);
      return [];
    }
  }

  private async getSettlementJobStats(): Promise<JobStats[]> {
    try {
      const jobs = await this.settlementQueue.getJobs(['completed', 'failed']);

      return [
        {
          type: 'activate_orders',
          count: jobs.length,
          lastCompleted:
            jobs.length > 0
              ? new Date(
                  Math.max(
                    ...jobs
                      .filter((j) => j.finishedOn)
                      .map((j) => j.finishedOn || 0),
                  ),
                )
              : undefined,
          lastFailed:
            jobs.length > 0
              ? new Date(
                  Math.max(
                    ...jobs
                      .filter((j) => j.failedReason)
                      .map((j) => j.finishedOn || 0),
                  ),
                )
              : undefined,
        },
      ];
    } catch (error) {
      this.logger.error('Failed to get settlement job stats:', error);
      return [];
    }
  }

  private async getSystemStats() {
    return {
      redisConnected: await this.checkRedisConnection(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  private async checkRedisConnection(): Promise<boolean> {
    try {
      // Try to ping Redis through one of the queues
      const client = await this.blogAiQueue.client;
      // Use a simple Redis command to check connection
      await client.get('test-connection');
      return true;
    } catch (error) {
      this.logger.error('Redis connection check failed:', error);
      return false;
    }
  }

  async pauseQueue(queueName: string): Promise<boolean> {
    try {
      const queue = this.getQueueByName(queueName);
      await queue.pause();
      this.logger.log(`Queue ${queueName} paused`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to pause queue ${queueName}:`, error);
      return false;
    }
  }

  async resumeQueue(queueName: string): Promise<boolean> {
    try {
      const queue = this.getQueueByName(queueName);
      await queue.resume();
      this.logger.log(`Queue ${queueName} resumed`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to resume queue ${queueName}:`, error);
      return false;
    }
  }

  async cleanQueue(
    queueName: string,
    grace: number = 1000 * 60 * 60 * 24,
  ): Promise<number> {
    try {
      const queue = this.getQueueByName(queueName);

      // Clean completed jobs older than grace period
      const completedJobs = await queue.clean(grace, 1000, 'completed');
      const completedCount = Array.isArray(completedJobs)
        ? completedJobs.length
        : 0;

      // Clean failed jobs older than grace period
      const failedJobs = await queue.clean(grace, 1000, 'failed');
      const failedCount = Array.isArray(failedJobs) ? failedJobs.length : 0;

      this.logger.log(
        `Cleaned ${completedCount} completed and ${failedCount} failed jobs from queue ${queueName}`,
      );
      return completedCount + failedCount;
    } catch (error) {
      this.logger.error(`Failed to clean queue ${queueName}:`, error);
      return 0;
    }
  }

  private getQueueByName(queueName: string): Queue {
    switch (queueName) {
      case 'blog-ai':
        return this.blogAiQueue;
      case 'avatar':
        return this.avatarQueue;
      case 'group_settlement':
        return this.settlementQueue;
      default:
        throw new Error(`Unknown queue: ${queueName}`);
    }
  }
}
