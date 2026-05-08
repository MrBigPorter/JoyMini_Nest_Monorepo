import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@api/common/prisma/prisma.module';
import { BlogController } from './blog.controller';
import { FrontendBlogController } from './frontend/frontend-blog.controller';
import { BookmarkController } from './frontend/bookmark.controller';
import { BlogService } from './blog.service';
import { FrontendBlogService } from './frontend/frontend-blog.service';
import { BookmarkService } from './frontend/bookmark.service';
import { CategoryModule } from './category/category.module';
import { TagModule } from './tag/tag.module';
import { CommentModule } from './comment/comment.module';
import { BlogAiProcessor } from './processors/blog-ai.processor';
import { TranslationJobService } from './translation-job.service';
import { SystemConfigModule } from '../admin/system-config/system-config.module';
import { LanguageService } from '@api/common/services/language.service';
import { LanguageDetectionService } from '@api/common/services/language-detection.service';
import { MEDIA_PROCESSOR_QUEUE } from '@api/common/media/media-processor.constants';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: 'blog-ai',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnFail: false, // 保留失败任务以便在 UI 中查看
      },
    }),
    BullModule.registerQueue({
      name: MEDIA_PROCESSOR_QUEUE,
    }),
    CategoryModule,
    TagModule,
    CommentModule,
    SystemConfigModule,
  ],
  controllers: [BlogController, FrontendBlogController, BookmarkController],
  providers: [
    BlogService,
    FrontendBlogService,
    BookmarkService,
    BlogAiProcessor,
    TranslationJobService,
    LanguageService,
    LanguageDetectionService,
  ],
  exports: [BlogService, TranslationJobService],
})
export class BlogModule {}
