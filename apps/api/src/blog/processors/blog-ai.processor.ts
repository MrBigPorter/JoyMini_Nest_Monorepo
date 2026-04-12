import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Marked } from 'marked';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CommentStatus } from '@prisma/client';

@Processor('blog-ai', {
  concurrency: 2, // 并发处理数
})
export class BlogAiProcessor extends WorkerHost {
  private readonly logger = new Logger(BlogAiProcessor.name);
  private readonly marked: Marked;

  constructor(
    private aiService: AiService,
    private prisma: PrismaService,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
  ) {
    super();
    this.marked = new Marked({
      gfm: true,
      breaks: true,
    });
  }

  /**
   * Markdown 渲染为 HTML
   */
  private renderMarkdown(md: string | null | undefined): string {
    if (!md) return '';
    return this.marked.parse(md) as string;
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'moderate-comment':
        return this.processCommentModeration(job, job.data);
      case 'auto-reply':
        return this.processAutoReply(job.data);
      case 'translate-article':
        return this.processArticleTranslation(job.data);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async processCommentModeration(
    job: Job,
    data: {
      commentId: string;
      content: string;
      articleTitle?: string;
    },
  ) {
    this.logger.debug(
      `Processing AI moderation for comment: ${data.commentId}`,
    );

    try {
      const result = await this.aiService.moderateComment(
        data.content,
        data.articleTitle,
      );

      // 更新评论审核结果
      await this.prisma.blogComment.update({
        where: { id: data.commentId },
        data: {
          aiModerationScore: result.score,
          aiModerationReason: result.reason,
          aiModerationCategories: result.categories.join(','),
          aiModeratedAt: new Date(),
          status: result.passed
            ? CommentStatus.APPROVED
            : CommentStatus.REJECTED,
        },
      });

      // 如果审核通过且有自动回复建议，延迟投递回复任务
      if (result.passed && result.autoReplySuggestion) {
        await this.blogAiQueue.add(
          'auto-reply',
          {
            commentId: data.commentId,
            replyContent: result.autoReplySuggestion,
            articleTitle: data.articleTitle,
          },
          {
            delay: 30000, // 30秒后自动回复，模拟真人延迟
          },
        );
      }

      this.logger.log(
        `AI moderation completed: comment ${data.commentId}, score ${result.score}, passed: ${result.passed}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `AI moderation failed for comment ${data.commentId}`,
        err,
      );
      throw err;
    }
  }

  private async processAutoReply(data: {
    commentId: string;
    replyContent: string;
    articleTitle?: string;
  }) {
    this.logger.debug(
      `Generating AI auto reply for comment: ${data.commentId}`,
    );

    try {
      const comment = await this.prisma.blogComment.findUnique({
        where: { id: data.commentId },
      });

      if (!comment || comment.status !== CommentStatus.APPROVED) {
        this.logger.debug(
          `Comment ${data.commentId} not approved, skipping auto reply`,
        );
        return;
      }

      // 创建AI自动回复
      await this.prisma.blogComment.create({
        data: {
          articleId: comment.articleId,
          parentId: comment.id,
          author: 'System',
          email: 'system@joyminis.com',
          content: data.replyContent,
          status: CommentStatus.APPROVED,
          isAiGenerated: true,
        },
      });

      // 异步更新评论计数
      this.prisma.blogArticle
        .update({
          where: { id: comment.articleId },
          data: { commentCount: { increment: 1 } },
        })
        .catch(() => {});

      this.logger.log(`AI auto reply created for comment ${data.commentId}`);
    } catch (err) {
      this.logger.error(
        `AI auto reply failed for comment ${data.commentId}`,
        err,
      );
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} completed successfully`);
  }

  private async processArticleTranslation(data: {
    articleId: string;
    targetLang: string;
  }) {
    this.logger.debug(
      `Translating article: ${data.articleId} to ${data.targetLang}`,
    );

    try {
      // 标记翻译中状态
      await this.prisma.blogArticle.update({
        where: { id: data.articleId },
        data: {
          translationStatus: 'TRANSLATING',
        },
      });

      const article = await this.prisma.blogArticle.findUnique({
        where: { id: data.articleId },
      });

      if (!article) {
        this.logger.warn(`Article ${data.articleId} not found`);
        return;
      }

      // 执行翻译 (使用串行执行而不是Promise.all避免并行请求同时失败)
      const titleTranslated = await this.aiService.translateText(
        article.title,
        data.targetLang,
      );
      // 翻译 Markdown 源而不是 HTML
      const contentTranslated = await this.aiService.translateMarkdown(
        article.contentMd || article.content,
        data.targetLang,
      );
      const excerptTranslated = article.excerpt
        ? await this.aiService.translateText(article.excerpt, data.targetLang)
        : null;

      // 保存翻译结果
      const updateData: any = {
        translationStatus: 'COMPLETED',
        translatedAt: new Date(),
      };

      const suffix =
        data.targetLang.charAt(0).toUpperCase() + data.targetLang.slice(1);
      updateData[`title${suffix}`] = titleTranslated;
      updateData[`contentMd${suffix}`] = contentTranslated;
      // 自动渲染对应语言HTML
      updateData[`content${suffix}`] = this.renderMarkdown(contentTranslated);
      updateData[`excerpt${suffix}`] = excerptTranslated;

      await this.prisma.blogArticle.update({
        where: { id: data.articleId },
        data: updateData,
      });

      this.logger.log(`Article translation completed: ${data.articleId}`);
    } catch (err) {
      this.logger.error(
        `Article translation failed for ${data.articleId}`,
        err,
      );

      // 识别OpenSSL兼容错误，这是环境配置问题，不是代码问题
      const isOpenSslError =
        err instanceof Error &&
        (err.message.includes('ERR_OSSL_UNSUPPORTED') ||
          err.message.includes('DECODER routines::unsupported'));
      if (isOpenSslError) {
        this.logger.warn(
          `Detected OpenSSL 3.0 compatibility error. Make sure NODE_OPTIONS=--openssl-legacy-provider is set for worker processes.`,
        );
      }

      await this.prisma.blogArticle
        .update({
          where: { id: data.articleId },
          data: {
            translationStatus: 'FAILED',
          },
        })
        .catch(() => {});

      // 不要重新抛出错误，避免队列无限重试
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        articleId: data.articleId,
      };
    }
  }
}
