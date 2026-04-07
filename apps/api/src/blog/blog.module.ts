import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { BlogController } from './blog.controller';
import { PublicBlogController } from './public/public-blog.controller';
import { BlogService } from './blog.service';
import { ArticleModule } from './article/article.module';
import { CategoryModule } from './category/category.module';
import { TagModule } from './tag/tag.module';
import { CommentModule } from './comment/comment.module';

@Module({
  imports: [
    PrismaModule,
    ArticleModule,
    CategoryModule,
    TagModule,
    CommentModule,
  ],
  controllers: [BlogController, PublicBlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
