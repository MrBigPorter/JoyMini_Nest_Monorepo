import { Module } from '@nestjs/common';
import { AiEvalController } from './ai-eval.controller';
import { AiEvalJudgeService } from './ai-eval-judge.service';
import { AiEvalDatasetService } from './ai-eval-dataset.service';

@Module({
  controllers: [AiEvalController],
  providers: [AiEvalJudgeService, AiEvalDatasetService],
})
export class AiEvalModule {}
