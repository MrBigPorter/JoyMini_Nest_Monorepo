import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AiModule } from '@api/common/ai/ai.module';
import { EmbeddingQueueModule } from '@api/common/ai/queues/embedding/embedding-queue.module';
import { IntentExamplesController } from './intent-examples.controller';
import { IntentExamplesService } from './intent-examples.service';

/**
 * IntentExamplesModule — 意图例句管理模块
 *
 * 🏪 餐厅类比：菜单管理办公室
 * ────────────────────────────────────────────────────────────
 * 这个模块负责管理「标准问答手册」（intent_examples 表），
 * 包括增删改查和批量重新生成向量。
 *
 * 现在使用 BullMQ 队列来处理 embedding 生成，
 * 避免批量操作时 API 超时。
 *
 * 模块依赖：
 * - PrismaModule: 数据库访问
 * - AiModule: AiService（用于 IntentClassifier 测试）
 * - EmbeddingQueueModule: BullMQ 队列（异步处理 embedding）
 */
@Module({
  imports: [PrismaModule, AiModule, EmbeddingQueueModule],
  controllers: [IntentExamplesController],
  providers: [IntentExamplesService],
  exports: [IntentExamplesService],
})
export class IntentExamplesModule {}
