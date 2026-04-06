import { Module } from '@nestjs/common';
import { ArticleService } from './article.service';

@Module({
  controllers: [],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}
