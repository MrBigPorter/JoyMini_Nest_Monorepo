import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { BlogAiProcessor } from '../processors/blog-ai.processor';
import { AiModule } from '@api/common/ai/ai.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'blog-ai',
    }),
    AiModule,
  ],
  controllers: [CommentController],
  providers: [CommentService, BlogAiProcessor],
  exports: [CommentService],
})
export class CommentModule {}
