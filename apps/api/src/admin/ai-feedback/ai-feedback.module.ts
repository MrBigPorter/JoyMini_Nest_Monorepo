import { Module } from '@nestjs/common';
import { AiFeedbackController } from './ai-feedback.controller';

@Module({
  controllers: [AiFeedbackController],
})
export class AiFeedbackModule {}
