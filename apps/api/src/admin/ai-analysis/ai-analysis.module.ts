import { Module } from '@nestjs/common';
import { AiEvalModule } from '@api/admin/ai-eval/ai-eval.module';
import { AiAnalysisController } from './ai-analysis.controller';
import { AiAnalysisService } from './ai-analysis.service';

@Module({
  imports: [AiEvalModule],
  controllers: [AiAnalysisController],
  providers: [AiAnalysisService],
  exports: [AiAnalysisService],
})
export class AiAnalysisModule {}
