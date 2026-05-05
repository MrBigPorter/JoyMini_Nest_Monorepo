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
   * 构建评论树形结构
   */
  private buildCommentTree(comments: any[]): any[] {
    // 创建评论映射表
    const commentMap = new Map<string, any>();
    const rootComments: any[] = [];

    // 初始化所有评论，添加 children 数组
    comments.forEach((comment) => {
      // 创建评论对象的副本，添加 children 字段
      const commentWithChildren = {
        ...comment,
        children: [],
      };
      commentMap.set(comment.id, commentWithChildren);
    });

    // 构建树形结构
    comments.forEach((comment) => {
      const node = commentMap.get(comment.id);
      if (comment.parentId) {
        // 如果有父评论，添加到父评论的 children 中
        const parent = commentMap.get(comment.parentId);
        if (parent) {
          parent.children.push(node);
        }
        // 注意：这里不添加到 rootComments，因为它是回复
      } else {
        // 没有父评论，作为根评论
        rootComments.push(node);
      }
    });

    // 按创建时间排序（根评论和子评论都排序）
    rootComments.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    rootComments.forEach((comment) => {
      if (comment.children.length > 0) {
        comment.children.sort(
          (a: any, b: any) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      }
    });

    return rootComments;
  }

  /**
   * 获取文章下的已审核评论（树形结构）
   */
  async getApprovedComments(articleId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    // 获取所有已审核评论（包括回复）
    const [allComments, total] = await Promise.all([
      this.prisma.blogComment.findMany({
        where: {
          articleId,
          status: CommentStatus.APPROVED,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.blogComment.count({
        where: {
          articleId,
          status: CommentStatus.APPROVED,
        },
      }),
    ]);

    // 构建树形结构
    const commentTree = this.buildCommentTree(allComments);

    // 分页处理：只对根评论进行分页
    const paginatedRootComments = commentTree.slice(skip, skip + pageSize);

    return {
      items: paginatedRootComments,
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
          article: { select: { id: true, title: true, slug: true } },
          parent: {
            select: {
              id: true,
              author: true,
              content: true,
              createdAt: true,
            },
          },
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
   * 更新评论状态和回复内容
   */
  async updateComment(
    commentId: string,
    data: { status?: CommentStatus; reply?: Record<string, string> },
  ) {
    const comment = await this.prisma.blogComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('评论不存在');
    }

    const updateData: any = {};

    if (data.status) {
      updateData.status = data.status;
    }

    if (data.reply !== undefined) {
      updateData.reply = data.reply;
    }

    return this.prisma.blogComment.update({
      where: { id: commentId },
      data: updateData,
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
