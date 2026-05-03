---
title: 'QueueMonitorService: BullMQ 队列监控仪表盘'
slug: queue-monitor-bullmq-dashboard
description: JoyMini API 的队列监控服务基于 BullMQ 事件系统构建实时仪表盘，跟踪队列状态、Job 进度、失败率和处理延迟，支持管理后台可视化运维。
tags:
  - NestJS
  - BullMQ
  - Queue
  - Monitoring
  - Dashboard
  - Redis
  - TypeScript
---

# QueueMonitorService: BullMQ 队列监控仪表盘

> **源码参考**: [`queue-monitor.service.ts`](apps/api/src/common/queue/queue-monitor.service.ts) (372 行)

---

## 概述

`QueueMonitorService` 提供了对平台所有 BullMQ 队列的统一监控接口。它暴露给管理后台一套 RESTful API，用于实时查看队列状态、作业统计、以及执行管理操作（暂停/恢复/清理）。

---

## 1. 受监控的队列

```typescript
private readonly queues: Queue[] = [];

constructor(
  @InjectQueue(BLOG_AI_QUEUE) private blogAiQueue: Queue,
  @InjectQueue(AVATAR_QUEUE_NAME) private avatarQueue: Queue,
  @InjectQueue(SETTLEMENT_QUEUE_NAME) private settlementQueue: Queue,
  @InjectQueue(MEDIA_PROCESSOR_QUEUE) private mediaQueue: Queue,
) {
  this.queues = [
    this.blogAiQueue,
    this.avatarQueue,
    this.settlementQueue,
    this.mediaQueue,
  ];
}
```

| 队列 | 用途 | 作业类型 |
|------|------|----------|
| `blog-ai` | AI 翻译 + 评论审核 | `article_translation`, `comment_moderation`, `auto_reply` |
| `avatar` | 群组头像合成 | `treasure_group_avatar`, `chat_group_avatar` |
| `group_settlement` | 拼团结算 | `group_settlement` |
| `media-process` | 媒体文件处理 | `compress_image`, `transcode_video` |

---

## 2. 核心 API

### 2.1 统一队列状态 — `getQueueStats()`

```typescript
async getQueueStats(): Promise<QueueMonitoringResponse> {
  const [queues, jobs, system] = await Promise.all([
    this.getQueueStatsByName('all'),
    this.getJobStats(),
    this.getSystemStats(),
  ]);

  return { queues, jobs, system };
}
```

**三个并行查询**:
- `getQueueStatsByName()` — 获取每个队列的 waiting/active/completed/failed/delayed 计数
- `getJobStats()` — 按队列和时间分组的作业统计数据
- `getSystemStats()` — Redis 连接状态 + 系统资源

### 2.2 单队列统计

```typescript
private async getQueueStatsByName(queueName: string): Promise<QueueStats[]> {
  const targetQueues = queueName === 'all'
    ? this.queues
    : [this.getQueueByName(queueName)];

  const stats = await Promise.all(
    targetQueues.map(async (queue) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      return {
        name: queue.name,
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      };
    }),
  );

  return stats;
}
```

**五个状态维度**:
- `waiting`: 排队中（未处理）
- `active`: 正在处理中
- `completed`: 已完成（保留期内）
- `failed`: 已失败（保留期内）
- `delayed`: 延迟执行（如重试间隔）

### 2.3 作业详细统计

```typescript
private async getJobStats(): Promise<Record<string, JobStats[]>> {
  return {
    'blog-ai': await this.getBlogAiJobStats(),
    'avatar': await this.getAvatarJobStats(),
    'settlement': await this.getSettlementJobStats(),
  };
}
```

每个队列的作业统计包含：

```typescript
interface JobStats {
  jobName: string;        // 作业类型名称
  count: number;          // 总次数
  avgDuration: number;    // 平均执行时间（ms）
  p50Duration: number;    // 中位数执行时间
  p95Duration: number;    // P95 执行时间
  p99Duration: number;    // P99 执行时间
  failureRate: number;    // 失败率（%）
  lastExecuted: Date;     // 最近执行时间
}
```

#### Blog AI 统计示例

```typescript
private async getBlogAiJobStats(): Promise<JobStats[]> {
  const completedJobs = await this.blogAiQueue.getCompleted();
  const failedJobs = await this.blogAiQueue.getFailed();

  // 按 job.name 分组
  const jobGroups = new Map<string, number[]>();
  const failedCounts = new Map<string, number>();

  for (const job of completedJobs) {
    const group = jobGroups.get(job.name) || [];
    group.push(job.finishedOn! - job.processedOn!);
    jobGroups.set(job.name, group);
  }

  for (const job of failedJobs) {
    failedCounts.set(job.name, (failedCounts.get(job.name) || 0) + 1);
  }

  return [...jobGroups.entries()].map(([name, durations]) => {
    durations.sort((a, b) => a - b);
    const total = durations.length;
    const failed = failedCounts.get(name) || 0;

    return {
      jobName: name,
      count: total,
      avgDuration: durations.reduce((a, b) => a + b, 0) / total,
      p50Duration: durations[Math.floor(total * 0.5)],
      p95Duration: durations[Math.floor(total * 0.95)],
      p99Duration: durations[Math.floor(total * 0.99)],
      failureRate: total > 0 ? (failed / (total + failed)) * 100 : 0,
      lastExecuted: new Date(Math.max(...durations)),
    };
  });
}
```

**百分位计算**: 通过对执行时间排序数组直接索引取值计算 P50/P95/P99，比数学公式更直观。

### 2.4 系统状态

```typescript
private async getSystemStats() {
  const redisConnected = await this.checkRedisConnection();
  return {
    redisConnected,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  };
}

private async checkRedisConnection(): Promise<boolean> {
  try {
    await this.redisClient.ping();
    return true;
  } catch {
    return false;
  }
}
```

简单的 Redis `PING` 健康检查。

---

## 3. 管理操作

### 3.1 暂停/恢复队列

```typescript
async pauseQueue(queueName: string): Promise<boolean> {
  try {
    const queue = this.getQueueByName(queueName);
    await queue.pause();
    this.logger.log(`Queue ${queueName} paused`);
    return true;
  } catch (error) {
    this.logger.error(`Failed to pause queue ${queueName}`, error);
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
    this.logger.error(`Failed to resume queue ${queueName}`, error);
    return false;
  }
}
```

### 3.2 清理历史作业

```typescript
async cleanQueue(
  queueName: string,
  gracePeriodMs: number = 24 * 60 * 60 * 1000,  // 默认 24 小时
  limit: number = 1000,
) {
  try {
    const queue = this.getQueueByName(queueName);
    const timestamp = Date.now() - gracePeriodMs;

    await queue.clean(gracePeriodMs, limit, 'completed');
    await queue.clean(gracePeriodMs, limit, 'failed');

    this.logger.log(`Cleaned ${queueName} queue (grace: ${gracePeriodMs}ms)`);
    return true;
  } catch (error) {
    this.logger.error(`Failed to clean queue ${queueName}`, error);
    return false;
  }
}
```

---

## 4. 队列路由解析器

```typescript
private getQueueByName(queueName: string): Queue {
  switch (queueName) {
    case 'blog-ai':
      return this.blogAiQueue;
    case 'avatar':
      return this.avatarQueue;
    case 'group_settlement':
      return this.settlementQueue;
    case 'media-process':
      return this.mediaQueue;
    default:
      throw new NotFoundException(`Queue ${queueName} not found`);
  }
}
```

---

## 5. 管理后台集成

在管理后台 API 层，监控数据通过以下端点暴露：

```typescript
@ApiTags('Queue Monitor')
@Controller('admin/queues')
export class QueueMonitorController {
  @Get('stats')
  async getStats() {
    return this.queueMonitorService.getQueueStats();
  }

  @Post(':name/pause')
  async pause(@Param('name') name: string) {
    return this.queueMonitorService.pauseQueue(name);
  }

  @Post(':name/resume')
  async resume(@Param('name') name: string) {
    return this.queueMonitorService.resumeQueue(name);
  }

  @Post(':name/clean')
  async clean(
    @Param('name') name: string,
    @Query('grace') grace?: number,
  ) {
    return this.queueMonitorService.cleanQueue(name, grace);
  }
}
```

---

## 6. 监控数据总线

队列监控数据结构完整视图：

```typescript
interface QueueMonitoringResponse {
  queues: QueueStats[];        // 各队列计数
  jobs: Record<string, JobStats[]>;  // 各作业类型统计
  system: {
    redisConnected: boolean;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    timestamp: string;
  };
}

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

interface JobStats {
  jobName: string;
  count: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  failureRate: number;
  lastExecuted: Date;
}
```

---

## 7. 生产运维建议

| 场景 | 操作 | 说明 |
|------|------|------|
| 队列积压 | `pause` + 排查 | 暂停队列防止新作业进入 |
| Worker 重启 | `pause` → restart → `resume` | 避免作业丢失 |
| 历史清理 | `clean` | 定期清理完成/失败的作业记录 |
| 故障排查 | 查看 `failed` 计数 + `getFailed()` | 分析失败作业详情 |
| 性能分析 | 查看 P95/P99 持续时间 | 定位慢作业 |

---

## 总结

`QueueMonitorService` 为运维团队提供了 **可观测性** 基础设施：

1. **统一视图**: 一次 API 调用获取所有队列的完整状态
2. **性能分析**: P50/P95/P99 百分位响应时间，帮助发现慢作业
3. **运维控制**: 暂停/恢复/清理操作无需重启服务
4. **健康检查**: Redis 连接状态实时监测
5. **低开销**: 所有 BullMQ 统计方法都是 O(1) 或 O(n) 的计数操作，不阻塞队列
