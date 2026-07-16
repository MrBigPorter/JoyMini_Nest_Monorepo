import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { AiService } from '../../ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { EMBEDDING_QUEUE } from './embedding-queue.constants';

/**
 * Embedding Job 数据类型
 *
 * 🏪 餐厅类比：化验单
 * ────────────────────────────────────────────────────────────
 * 每张化验单上写着：
 *   - domain: 哪个部门送来的样本（如 "order"）
 *   - sentence: 要化验的文本（如 "我要退货"）
 *   - configHash: 批次号（用于追踪是哪一批送来的）
 */
export interface EmbeddingJobData {
  domain: string;
  sentence: string;
  configHash: string;
}

/**
 * EmbeddingProcessor — BullMQ Worker，处理 embedding 向量化任务
 *
 * 🏪 餐厅类比：化验室工作人员
 * ═══════════════════════════════════════════════════════════════
 *
 * 【为什么需要这个队列？】
 * 之前的问题：管理后台批量保存例句时，直接调用 generateEmbedding()
 * 30 条 × 5 秒/条 = 150 秒 > 120 秒（API 网关超时）
 *
 * 【队列怎么解决？】
 * 1. 服务员（IntentExamplesService）不再亲自跑化验室，
 *    而是把 30 张化验单贴在窗口上（queue.add()）
 * 2. 化验室工作人员（EmbeddingProcessor）一次只处理 2 张（concurrency:2）
 * 3. 服务员贴完单子就可以回去接待客人了（API 立即返回 202）
 * 4. 化验结果出来后自动写入数据库
 *
 * 【concurrency: 2 的含义】
 * 同时只开 2 台化验仪器，避免 Ollama 被太多请求打爆。
 * 每台仪器处理一个样本约 5 秒，
 * 30 个样本 = 15 批 × 5 秒 = 75 秒（远小于 120 秒超时）
 *
 * 【数据生命周期】
 * 1. queue.add() → Redis LPUSH（化验单贴上窗口）
 * 2. Worker 空闲 → Redis RPOP（取下一张化验单）
 * 3. process() 执行中 → Job 状态变为 "active"
 * 4. process() 返回 → BullMQ 自动删除 Redis 中的 job 数据
 * 5. 如果失败 → 自动重试（默认最多 3 次）
 *
 * 详见 docs/AI-joymini/56-BullMQ-Queue-Explanation.md
 *
 * ═══════════════════════════════════════════════════════════════
 */
@Processor(EMBEDDING_QUEUE, {
  concurrency: 2, // 同时只处理 2 个 embedding 请求，保护 Ollama 不被打爆
})
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  /**
   * 处理单个 embedding 任务
   *
   * 🏪 餐厅类比：化验室工作人员处理一张化验单
   * ────────────────────────────────────────────────────────────
   * 1. 从窗口取下一张化验单（Job）
   * 2. 看化验单内容：哪个部门的（domain）、什么文本（sentence）
   * 3. 送进 bge-m3 化验仪器（generateEmbedding）
   * 4. 拿到化验报告（vector）
   * 5. 把结果登记到数据库（INSERT INTO intent_examples）
   * 6. 完成，BullMQ 自动从窗口撕掉这张化验单
   */
  async process(job: Job<EmbeddingJobData, any, string>): Promise<void> {
    const { domain, sentence, configHash } = job.data;
    const preview = sentence.slice(0, 40);

    this.logger.debug(
      `[Job ${job.id}] Processing embedding for "${domain}": "${preview}..."`,
    );

    // 送进化验仪器（bge-m3）生成向量
    const vector = await this.aiService.generateEmbedding(sentence, {
      task: 'retrieval.passage',
    });

    if (!vector || vector.length === 0) {
      // 化验失败（仪器故障、网络问题等）
      // 不抛异常 = 不重试，记录日志后跳过
      this.logger.warn(
        `[Job ${job.id}] Failed to embed "${preview}..." for "${domain}" — skipping`,
      );
      return;
    }

    // 把化验结果登记到数据库
    const vectorStr = `[${vector.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO intent_examples (id, domain, sentence, embedding, "configHash")
       VALUES ($1, $2, $3, $4::vector, $5)`,
      this.generateId(),
      domain,
      sentence,
      vectorStr,
      configHash,
    );

    this.logger.debug(
      `[Job ${job.id}] Embedded "${preview}..." for "${domain}" (${vector.length} dims)`,
    );
  }

  /** 任务完成事件 */
  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(
      `[Job ${job.id}] Embedding completed for "${job.data.domain}"`,
    );
  }

  /** 任务失败事件 */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[Job ${job.id}] Embedding failed for "${job.data?.domain}" (attempt ${job.attemptsMade}): ${error.message}`,
    );
  }

  /** 生成简短唯一 ID */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
}
