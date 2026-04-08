import { Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
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
  providers: [
    CommentService,
    BlogAiProcessor,
    {
      provide: 'BLOG_AI_QUEUE',
      useFactory: (queue: Queue) => queue,
      inject: [InjectQueue('blog-ai')],
    },
  ],
  exports: [CommentService, 'BLOG_AI_QUEUE'],
})
export class CommentModule {}
