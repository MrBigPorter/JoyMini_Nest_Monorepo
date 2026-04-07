import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CommentStatus } from '@prisma/client';
import { AiService } from '@api/common/ai/ai.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    @InjectQueue('blog-ai') private aiQueue: Queue,
  ) {}
  /**
   * 创建评论 (公开接口)
   */
  async createComment(
    articleId: string,
    data: {
      nickname: string;
      email?: string;
      content: string;
      website?: string;
      parentId?: string;
      ip?: string;
      userAgent?: string;
    },
  ) {
    // 1. 先保存评论到数据库
    const comment = await this.prisma.blogComment.create({
      data: {
        articleId,
        author: data.nickname,
        email: data.email!,
        website: data.website,
        content: data.content,
        parentId: data.parentId,
        status: CommentStatus.PENDING,
        ipAddress: data.ip,
        userAgent: data.userAgent,
      },
      include: {
        article: { select: { title: true } },
      },
    });

    // 2. 异步投递到AI处理队列，不阻塞用户请求
    if (this.aiService.isAvailable()) {
      this.aiQueue
        .add(
          'moderate-comment',
          {
            commentId: comment.id,
            content: comment.content,
            articleTitle: comment.article?.title,
          },
          {
            delay: 1000, // 延迟1秒处理，避免高峰压力
            attempts: 2,
          },
        )
        .catch((err) => {
          this.logger.warn('Failed to queue AI moderation', err);
        });
    }

    return comment;
  }

  /**
   * 获取文章下的已审核评论
   */
  async getApprovedComments(articleId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.blogComment.findMany({
        where: {
          articleId,
          status: CommentStatus.APPROVED,
        },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.blogComment.count({
        where: {
          articleId,
          status: CommentStatus.APPROVED,
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取所有评论 (管理员)
   */
  async getAllComments(params: {
    page?: number;
    pageSize?: number;
    status?: CommentStatus;
    articleId?: string;
  }) {
    const { page = 1, pageSize = 20, status, articleId } = params;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (articleId) {
      where.articleId = articleId;
    }

    const [items, total] = await Promise.all([
      this.prisma.blogComment.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          article: { select: { id: true, title: true } },
        },
      }),
      this.prisma.blogComment.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 审核通过
   */
  async approveComment(commentId: string) {
    const comment = await this.prisma.blogComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('评论不存在');
    }

    // 异步更新文章评论计数
    this.prisma.blogArticle
      .update({
        where: { id: comment.articleId },
        data: { commentCount: { increment: 1 } },
      })
      .catch(() => {});

    return this.prisma.blogComment.update({
      where: { id: commentId },
      data: {
        status: CommentStatus.APPROVED,
      },
    });
  }

  /**
   * 审核拒绝
   */
  async rejectComment(commentId: string) {
    return this.prisma.blogComment.update({
      where: { id: commentId },
      data: {
        status: CommentStatus.REJECTED,
      },
    });
  }

  /**
   * 删除评论
   */
  async deleteComment(commentId: string) {
    return this.prisma.blogComment.delete({
      where: { id: commentId },
    });
  }
}
