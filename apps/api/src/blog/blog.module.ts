import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { BlogController } from './blog.controller';
import { PublicBlogController } from './public/public-blog.controller';
import { BlogService } from './blog.service';
import { CategoryModule } from './category/category.module';
import { TagModule } from './tag/tag.module';
import { CommentModule } from './comment/comment.module';
import { BlogAiProcessor } from './processors/blog-ai.processor';
import { SystemConfigModule } from '../admin/system-config/system-config.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'blog-ai',
    }),
    CategoryModule,
    TagModule,
    CommentModule,
    SystemConfigModule,
  ],
  controllers: [BlogController, PublicBlogController],
  providers: [BlogService, BlogAiProcessor],
  exports: [BlogService],
})
export class BlogModule {}
