import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AiModule } from '../../ai.module';
import { EmbeddingProcessor } from './embedding.processor';
import { EMBEDDING_QUEUE } from './embedding-queue.constants';

/**
 * EmbeddingQueueModule — Embedding 向量化队列模块
 *
 * 🏪 餐厅类比：化验室取号系统
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个模块负责：
 * 1. 注册 BullMQ 队列（取号系统）
 * 2. 注册 Worker（化验室工作人员）
 *
 * 【为什么需要独立模块？】
 * 遵循项目中其他队列模块的模式（如 MediaProcessorModule），
 * 把队列注册和 Worker 注册放在一个模块里，方便复用。
 *
 * 【模块依赖】
 * - BullModule.registerQueue → 注册队列到 Redis
 * - AiModule → 需要 AiService 来生成 embedding
 * - PrismaModule → 需要写入 intent_examples 表
 *
 * 【使用方式】
 * 在其他模块中导入 EmbeddingQueueModule，
 * 然后通过 @InjectQueue(EMBEDDING_QUEUE) 注入 Queue 实例，
 * 调用 queue.add() 提交任务。
 *
 * 详见 docs/AI-joymini/56-BullMQ-Queue-Explanation.md
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: EMBEDDING_QUEUE,
    }),
    AiModule,
    PrismaModule,
  ],
  providers: [EmbeddingProcessor],
  exports: [BullModule],
})
export class EmbeddingQueueModule {}
