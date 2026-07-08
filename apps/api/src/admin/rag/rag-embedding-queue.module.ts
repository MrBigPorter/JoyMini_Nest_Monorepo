import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RAG_EMBEDDING_QUEUE } from './rag-embedding-queue.constants';
import { RagEmbeddingProcessor } from './rag-embedding.processor';
import { RagEmbeddingService } from './rag-embedding.service';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AiModule } from '@api/common/ai/ai.module';

/**
 * RagEmbeddingQueueModule — 知识库文档 Chunk 向量化队列模块
 *
 * 🏪 餐厅类比：知识库化验室取号系统
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个模块负责：
 * 1. 注册 BullMQ 队列（rag-embedding 取号系统）
 * 2. 注册 Worker（知识库化验室工作人员）
 *
 * 【为什么需要独立模块？】
 * 遵循项目中其他队列模块的模式（如 EmbeddingQueueModule），
 * 把队列注册和 Worker 注册放在一个模块里，方便复用。
 *
 * 【与 EmbeddingQueueModule 的区别】
 * - EmbeddingQueueModule（common/ai/queues/embedding/）：
 *   用于 Intent Examples 的"一句一 job"向量化
 * - RagEmbeddingQueueModule（admin/rag/）：
 *   用于知识库文档的"一篇文档一 job"向量化
 * 两者独立，互不影响，可以分别控制 concurrency。
 *
 * 【模块依赖】
 * - BullModule.registerQueue → 注册队列到 Redis
 * - RagEmbeddingService → 实际的向量化逻辑（可测试、可复用）
 * - PrismaModule → 需要查询 document_chunks 表
 * - AiModule → 需要 AiService.generateEmbedding()
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: RAG_EMBEDDING_QUEUE,
    }),
    PrismaModule,
    AiModule,
  ],
  providers: [RagEmbeddingProcessor, RagEmbeddingService],
  exports: [BullModule],
})
export class RagEmbeddingQueueModule {}
