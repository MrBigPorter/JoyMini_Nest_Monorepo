import { Module } from '@nestjs/common';
import { AiCustomerModule } from '@api/client/ai-customer/ai-customer.module';
import { AiCustomerService } from '@api/client/ai-customer/ai-customer.service';
import { AiEvalController } from './ai-eval.controller';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import {
  AI_EVAL_LIVE_AI,
  AiEvalDatasetService,
} from './ai-eval-dataset.service';

@Module({
  // LIVE 模式直接复用真实客服 graph；AiCustomerModule 在 AppModule 中已是单例。
  imports: [AiCustomerModule],
  controllers: [AiEvalController],
  providers: [
    AiEvalJudgeService,
    AiEvalDatasetService,
    {
      provide: AI_EVAL_LIVE_AI,
      useFactory: (aiCustomer: AiCustomerService) => aiCustomer,
      inject: [AiCustomerService],
    },
  ],
})
export class AiEvalModule {}
