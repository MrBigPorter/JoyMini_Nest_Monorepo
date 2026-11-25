import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiCustomerModule } from '@api/client/ai-customer/ai-customer.module';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { CorpusFingerprintModule } from '@api/common/knowledge/corpus-fingerprint.module';
import { RedisLockModule } from '@api/common/redis/redis-lock.module';
import { AiEvalController } from './ai-eval.controller';
import { EvalReportsController } from './eval-reports.controller';
import { AnnotationQueueController } from './annotation-queue.controller';
import { AnnotationQueueService } from './annotation-queue.service';
import { EvalReportsService } from './eval-reports.service';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import {
  AI_EVAL_LIVE_AI,
  AiEvalDatasetService,
} from './ai-eval-dataset.service';
import { AI_EVAL_QUEUE } from './ai-eval.queue';
import { AiEvalProcessor } from './ai-eval.processor';
import { AiEvalRunSweepTask } from './ai-eval-run-sweep.task';

@Module({
  // LIVE 模式直接复用真实客服 graph；AiCustomerModule 在 AppModule 中已是单例。
  imports: [
    AiCustomerModule,
    CorpusFingerprintModule,
    RedisLockModule,
    BullModule.registerQueue({ name: AI_EVAL_QUEUE }),
  ],
  controllers: [
    AiEvalController,
    EvalReportsController,
    AnnotationQueueController,
  ],
  exports: [AiEvalDatasetService],
  providers: [
    AiEvalJudgeService,
    AiEvalDatasetService,
    EvalReportsService,
    AnnotationQueueService,
    AiEvalProcessor,
    AiEvalRunSweepTask,
    {
      provide: AI_EVAL_LIVE_AI,
      useFactory: (aiCustomer: AiCustomerService) => aiCustomer,
      inject: [AiCustomerService],
    },
  ],
})
export class AiEvalModule {}
