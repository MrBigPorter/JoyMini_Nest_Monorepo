import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { AiModule } from '@api/common/ai/ai.module';
import { RedisLockModule } from '@api/common/redis/redis-lock.module';
import { RagModule } from '@api/admin/rag/rag.module';
import { IntentDomainsModule } from '@api/admin/intent-domains/intent-domains.module';
import { IntentExamplesModule } from '@api/admin/intent-examples/intent-examples.module';
import { KB_GENERATION_QUEUE } from './kb-generation.constants';
import { KbCandidateGenerator } from './kb-candidate-generator';
import { KbCandidateDedupeService } from './kb-candidate-dedupe.service';
import { KbGenerationService } from './kb-generation.service';
import { KbGenerationQueue } from './kb-generation.queue';
import { KbGenerationListener } from './kb-generation.listener';
import { KbGenerationProcessor } from './kb-generation.processor';
import { KbGenerationReconcileTask } from './kb-generation.reconcile.task';
import { KbKeywordAutoApplyService } from './kb-keyword-auto-apply.service';
import { KbCandidatesController } from './kb-candidates.controller';
import { KbCandidatesService } from './kb-candidates.service';

/**
 * 知识库驱动候选生成（121-M1）。
 *
 * 必须挂在 AdminModule（与 rag-embedding worker 同进程）：
 * 发布事件由 RagEmbeddingProcessor 所在的进程发出，监听器收不到就漏了。
 *
 * 依赖说明：
 *   - RagModule → KnowledgeDomainService（文档域 → 意图域映射）
 *   - IntentDomainsModule → 目标意图校验
 *   - AiModule → 生成与去重嵌入
 *   - RedisLockModule → 补偿扫描多实例互斥
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: KB_GENERATION_QUEUE,
      // jobId 是幂等键；attempts=1 因为业务失败已落 run.status，
      // 重试由补偿扫描按 30 分钟窗口决定，不在 BullMQ 里空转。
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
    PrismaModule,
    AiModule,
    RedisLockModule,
    RagModule,
    IntentDomainsModule,
    IntentExamplesModule,
  ],
  controllers: [KbCandidatesController],
  providers: [
    KbCandidateGenerator,
    KbKeywordAutoApplyService,
    KbCandidatesService,
    KbCandidateDedupeService,
    KbGenerationQueue,
    KbGenerationService,
    KbGenerationListener,
    KbGenerationProcessor,
    KbGenerationReconcileTask,
  ],
  exports: [KbGenerationService, KbGenerationQueue],
})
export class KbGenerationModule {}
