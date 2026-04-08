import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ArticleService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
  ) {}

  /**
   * 获取文章列表
   */
  async getArticles() {
    return this.prisma.blogArticle.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, username: true, realName: true } },
        category: true,
        tags: true,
      },
    });
  }

  /**
   * 获取文章详情
   */
  async getArticle(id: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, realName: true } },
        category: true,
        tags: true,
      },
    });

    if (!article) {
      throw new NotFoundException('article not found');
    }

    return article;
  }

  async createArticle(data: {
    title: string;
    content: string;
    excerpt?: string;
    categoryId?: string;
    tagIds?: string[];
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    featuredImage?: string;
    authorId?: string;
  }) {
    // 默认值：状态为草稿，作者为当前用户（暂时写死）
    const slug = data.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const payload = {
      title: data.title,
      content: data.content,
      excerpt: data.excerpt ?? '',
      slug,
      categoryId: data.categoryId || null,
      status: data.status || 'DRAFT',
      featuredImage: data.featuredImage || null,
      authorId: data.authorId || 'admin', // 待替换为真实用户ID
    };
    const article = await this.prisma.blogArticle.create({
      data: payload,
    });
    // 处理标签关联
    if (data.tagIds && data.tagIds.length > 0) {
      await this.prisma.blogArticle.update({
        where: { id: article.id },
        data: {
          tags: {
            connect: data.tagIds.map((id) => ({ id })),
          },
        },
      });
    }

    // 异步投递翻译任务
    this.blogAiQueue
      .add('translate-article', {
        articleId: article.id,
        targetLang: 'en',
      })
      .catch(() => {});

    return article;
  }

  async updateArticle(
    id: string,
    data: {
      title?: string;
      content?: string;
      excerpt?: string;
      titleEn?: string;
      contentEn?: string;
      excerptEn?: string;
      categoryId?: string;
      tagIds?: string[];
      status?: string;
      featuredImage?: string;
    },
  ) {
    // 检查文章是否存在
    const existing = await this.prisma.blogArticle.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('article not found');
    }
    const payload: any = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.content !== undefined) payload.content = data.content;
    if (data.excerpt !== undefined) payload.excerpt = data.excerpt;
    if (data.titleEn !== undefined) payload.titleEn = data.titleEn;
    if (data.contentEn !== undefined) payload.contentEn = data.contentEn;
    if (data.excerptEn !== undefined) payload.excerptEn = data.excerptEn;
    if (data.categoryId !== undefined) payload.categoryId = data.categoryId;
    if (data.status !== undefined) payload.status = data.status;
    if (data.featuredImage !== undefined)
      payload.featuredImage = data.featuredImage;
    // 更新文章基础字段
    const updated = await this.prisma.blogArticle.update({
      where: { id },
      data: payload,
    });
    // 更新标签关联
    if (data.tagIds !== undefined) {
      // 先断开现有标签
      await this.prisma.blogArticle.update({
        where: { id },
        data: {
          tags: {
            set: [],
          },
        },
      });
      // 连接新标签
      if (data.tagIds.length > 0) {
        await this.prisma.blogArticle.update({
          where: { id },
          data: {
            tags: {
              connect: data.tagIds.map((tagId) => ({ id: tagId })),
            },
          },
        });
      }
    }
    // 只有标题或内容变更时才重新翻译
    if (data.title !== undefined || data.content !== undefined) {
      this.blogAiQueue
        .add('translate-article', {
          articleId: id,
          targetLang: 'en',
        })
        .catch(() => {});
    }

    return updated;
  }

  async deleteArticle(id: string) {
    const existing = await this.prisma.blogArticle.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('article not found');
    }
    await this.prisma.blogArticle.delete({ where: { id } });
    return { message: '文章已删除' };
  }

  async publishArticle(id: string) {
    const existing = await this.prisma.blogArticle.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('article not found');
    }
    const updated = await this.prisma.blogArticle.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    return updated;
  }

  async unpublishArticle(id: string) {
    const existing = await this.prisma.blogArticle.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('article not found');
    }
    const updated = await this.prisma.blogArticle.update({
      where: { id },
      data: { status: 'DRAFT', publishedAt: null },
    });
    return updated;
  }

  async translateArticle(id: string) {
    const existing = await this.prisma.blogArticle.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('article not found');
    }

    // 投递翻译任务
    await this.blogAiQueue.add('translate-article', {
      articleId: id,
      targetLang: 'en',
    });

    return {
      success: true,
      message: 'Translation task has been queued',
      articleId: id,
    };
  }
}
