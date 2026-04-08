import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ArticleService } from './article.service';
import { ArticleController } from './article.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'blog-ai',
    }),
  ],
  controllers: [ArticleController],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}
