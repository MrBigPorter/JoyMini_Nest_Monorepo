import { Module } from '@nestjs/common';
import { AiEvalController } from './ai-eval.controller';
import { AiEvalJudgeService } from './ai-eval-judge.service';

@Module({
  controllers: [AiEvalController],
  providers: [AiEvalJudgeService],
})
export class AiEvalModule {}
