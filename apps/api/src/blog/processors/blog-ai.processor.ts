import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
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

  constructor(
    private aiService: AiService,
    private prisma: PrismaService,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'moderate-comment':
        return this.processCommentModeration(job, job.data);
      case 'auto-reply':
        return this.processAutoReply(job.data);
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
}
