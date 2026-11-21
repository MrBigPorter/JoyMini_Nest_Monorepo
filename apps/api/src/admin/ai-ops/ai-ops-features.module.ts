import { Module } from '@nestjs/common';
import { AiOpsFeaturesController } from './ai-ops-features.controller';

@Module({
  controllers: [AiOpsFeaturesController],
})
export class AiOpsFeaturesModule {}
