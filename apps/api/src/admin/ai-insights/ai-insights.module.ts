import { Module } from '@nestjs/common';
import { AiInsightsController } from './ai-insights.controller';
import { AiInsightsService } from './ai-insights.service';

@Module({
  controllers: [AiInsightsController],
  providers: [AiInsightsService],
})
export class AiInsightsAdminModule {}
