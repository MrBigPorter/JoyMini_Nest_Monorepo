import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RagEmbeddingService } from './rag-embedding.service';
import { RAG_EMBEDDING_QUEUE } from './rag-embedding-queue.constants';
import { PrismaService } from '@api/common/prisma/prisma.service';

/**
 * Rag Embedding Job 数据类型
 *
 * 每个 job 对应一篇文档的所有 chunk 向量化任务。
 * 为什么按文档聚合而不是每个 chunk 一个 job？
 *   1. 知识库上传频次低，不需要极端并行
 *   2. RagEmbeddingService.embedDocument() 内部已有 p-limit(2) 并发控制
 *   3. 减少 Redis 中 job 数量，降低管理开销
 */
export interface RagEmbeddingJobData {
  /** KnowledgeDocument 的 ID */
  documentId: string;
  /**
   * 是否强制覆盖已有向量。
   * - false（默认）：只处理 embedding IS NULL 的 chunk
   * - true：所有 chunk 重新生成
   */
  force?: boolean;
}

/**
 * RagEmbeddingProcessor — BullMQ Worker，处理知识库文档 chunk 向量化任务
 *
 * 🏪 餐厅类比：化验室工作人员（专门处理知识库文档的化验）
 * ═══════════════════════════════════════════════════════════════
 *
 * 【为什么需要这个队列？】
 * 之前的问题：管理后台上传大文档时，embedDocument() 同步等待
 * 200 个 chunk × 300ms = 60 秒 > 30 秒（API 网关超时）
 *
 * 【队列怎么解决？】
 * 1. 服务员（RagSyncService）不再亲自跑化验室，
 *    而是把化验单贴在窗口上（queue.add()）
 * 2. 化验室工作人员（RagEmbeddingProcessor）一次只处理 2 篇文档（concurrency:2）
 * 3. 服务员贴完单子就可以回去接待客人了（API 立即返回）
 * 4. 每篇文档内部的 chunk 用 p-limit(2) 控制并发
 *
 * 【concurrency: 2 的含义】
 * 同时只处理 2 篇文档的向量化，避免 Ollama 被太多请求打爆。
 * 每篇文档内部还有 p-limit(2)，所以实际 Ollama 并发 = 2 × 2 = 4。
 *
 * 【数据生命周期】
 * 1. queue.add() → Redis LPUSH
 * 2. Worker 空闲 → Redis RPOP
 * 3. process() 执行中 → Job 状态变为 "active"
 * 4. process() 返回 → BullMQ 自动删除 Redis 中的 job 数据
 * 5. 如果失败 → 自动重试（默认最多 3 次）
 */
@Processor(RAG_EMBEDDING_QUEUE, {
  concurrency: 2, // 同时只处理 2 篇文档，保护 Ollama 不被打爆
})
export class RagEmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(RagEmbeddingProcessor.name);

  constructor(
    private readonly ragEmbeddingService: RagEmbeddingService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  /**
   * 处理单个文档的 chunk 向量化任务
   *
   * 🏪 餐厅类比：化验室工作人员处理一篇文档的化验
   * ────────────────────────────────────────────────────────────
   * 1. 从窗口取下一张化验单（Job），上面写着文档 ID
   * 2. 去档案室找出这篇文档的所有 chunk（数据库查询）
   * 3. 逐个送进 bge-m3 化验仪器（generateEmbedding）
   * 4. 每个 chunk 化验完立即登记结果（UPDATE embedding 列）
   * 5. 全部完成 → 更新文档状态为 indexed
   * 6. BullMQ 自动从窗口撕掉这张化验单
   */
  async process(job: Job<RagEmbeddingJobData, any, string>): Promise<void> {
    const { documentId, force } = job.data;

    this.logger.log(
      `[Job ${job.id}] Processing embedding for document ${documentId}` +
        (force ? ' (force)' : ''),
    );

    // 委托给 RagEmbeddingService 执行实际的向量化逻辑
    // 这样核心逻辑可测试、可复用（比如直接调用 embedDocument 做同步处理）
    const result = await this.ragEmbeddingService.embedDocument(documentId, {
      force,
    });

    this.logger.log(
      `[Job ${job.id}] Document ${documentId} embedding done: ` +
        `${result.successCount} success, ${result.failCount} failed` +
        ` in ${result.durationMs}ms`,
    );

    // 如果有失败的 chunk，记录警告但不抛异常
    // 不抛异常 = BullMQ 不会重试，失败的 chunk 保持 embedding IS NULL
    // 用户可以通过前端的 reindex 按钮手动重试
    if (result.failCount > 0) {
      this.logger.warn(
        `[Job ${job.id}] ${result.failCount} chunks failed for document ${documentId}: ` +
          result.errors
            .map((e) => `chunk[${e.chunkIndex}]: ${e.reason}`)
            .join('; '),
      );
    }

    // 无论是否有失败的 chunk，都更新文档状态为 indexed
    // 因为至少部分 chunk 已经向量化 + 索引到 Meilisearch
    try {
      await this.prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { processStatus: 'indexed' },
      });
      this.logger.log(
        `[Job ${job.id}] Document ${documentId} status → indexed`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[Job ${job.id}] Failed to update status to indexed: ${message}`,
      );
    }
  }

  /** 任务完成事件 */
  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(
      `[Job ${job.id}] Rag embedding completed for document ${job.data?.documentId}`,
    );
  }

  /** 任务失败事件 */
  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `[Job ${job.id}] Rag embedding failed for document ${job.data?.documentId} ` +
        `(attempt ${job.attemptsMade}): ${error.message}`,
    );
  }
}
