import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { FrontendBlogService } from './frontend-blog.service';

@Injectable()
export class BookmarkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly frontendBlogService: FrontendBlogService,
  ) {}

  /**
   * 获取用户收藏列表
   */
  async getUserBookmarks(
    userId: string,
    params: { page?: number; pageSize?: number; locale?: string },
  ) {
    const { page = 1, pageSize = 10, locale = 'zh' } = params;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.userBookmark.findMany({
        where: { userId },
        include: {
          article: {
            include: {
              category: true,
              tags: true,
              author: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.userBookmark.count({ where: { userId } }),
    ]);

    // 转换文章数据为前端格式
    const formattedItems = items.map((bookmark) => ({
      ...this.mapArticleForFrontend(bookmark.article, locale),
      bookmarkedAt: bookmark.createdAt,
    }));

    return {
      items: formattedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 收藏文章
   */
  async addBookmark(userId: string, articleId: string) {
    return this.prisma.userBookmark.upsert({
      where: {
        userId_articleId: {
          userId,
          articleId,
        },
      },
      create: {
        userId,
        articleId,
      },
      update: {}, // 如果已存在，不做任何更新
    });
  }

  /**
   * 取消收藏
   */
  async removeBookmark(userId: string, articleId: string) {
    return this.prisma.userBookmark.delete({
      where: {
        userId_articleId: {
          userId,
          articleId,
        },
      },
    });
  }

  /**
   * 检查收藏状态
   */
  async checkBookmarkStatus(userId: string, articleId: string) {
    const bookmark = await this.prisma.userBookmark.findUnique({
      where: {
        userId_articleId: {
          userId,
          articleId,
        },
      },
    });

    return {
      isBookmarked: !!bookmark,
      bookmarkedAt: bookmark?.createdAt,
    };
  }

  /**
   * 将文章转换为前端专用格式
   * 复用 FrontendBlogService 中的映射逻辑
   */
  private mapArticleForFrontend(article: any, locale: string) {
    // 这里我们直接调用 FrontendBlogService 的私有方法
    // 由于 TypeScript 限制，我们需要通过一个辅助方法来访问私有方法
    // 或者我们可以复制映射逻辑，但为了代码复用，我们使用类型断言
    const frontendService = this.frontendBlogService as any;

    // 检查是否有 mapArticleForFrontend 方法
    if (frontendService.mapArticleForFrontend) {
      return frontendService.mapArticleForFrontend(article, locale, {
        includeContent: false,
      });
    }

    // 如果没有找到方法，使用简单的映射
    return {
      id: article.id,
      slug: article.slug,
      title: this.getLocalizedString(article, 'title', locale),
      excerpt: this.getLocalizedString(article, 'excerpt', locale),
      coverImage: this.getLocalizedString(article, 'coverImage', locale),
      views: article.viewCount || 0,
      likes: article.likeCount || 0,
      commentsCount: article.commentCount || 0,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
      category: article.category
        ? {
            id: article.category.id,
            name: this.getLocalizedString(article.category, 'name', locale),
            slug: article.category.slug,
          }
        : null,
      tags:
        article.tags?.map((tag: any) => ({
          id: tag.id,
          name: this.getLocalizedString(tag, 'name', locale),
          slug: tag.slug,
        })) || [],
      author: article.author
        ? {
            id: article.author.id,
            name: article.author.realName || article.author.username,
            avatar: null, // AdminUser 没有 avatar 字段
          }
        : null,
    };
  }

  /**
   * 获取本地化字符串
   * 简化版实现，优先返回指定语言，否则返回中文，否则返回空字符串
   */
  private getLocalizedString(
    entity: any,
    field: string,
    locale: string,
  ): string {
    // 首先检查字段本身是否已经是 Localized 对象
    const fieldValue = entity[field];
    // 如果字段本身就是 Localized 对象（如 {en: "...", zh: "..."}）
    if (fieldValue && typeof fieldValue === 'object' && fieldValue !== null) {
      // 优先返回指定语言的值
      if (fieldValue[locale] && typeof fieldValue[locale] === 'string') {
        return fieldValue[locale];
      }
      // 回退到中文
      if (fieldValue['zh'] && typeof fieldValue['zh'] === 'string') {
        return fieldValue['zh'];
      }
      // 回退到第一个可用的字符串值
      const firstStringValue = Object.values(fieldValue).find(
        (v) => typeof v === 'string',
      );
      if (firstStringValue) {
        return firstStringValue as string;
      }
    }

    // 检查 Localized 字段（原始格式）
    const localizedField = entity[`${field}Localized`];

    if (localizedField && localizedField[locale]) {
      return localizedField[locale];
    }

    // 检查独立字段（如 titleEn, excerptEn 等）
    const suffix =
      locale === 'zh' ? '' : locale.charAt(0).toUpperCase() + locale.slice(1);
    const dbValue = entity[`${field}${suffix}`];

    if (dbValue !== null && dbValue !== undefined && dbValue !== '') {
      return dbValue;
    }

    // 回退到中文
    if (localizedField && localizedField['zh']) {
      return localizedField['zh'];
    }

    // 检查中文独立字段
    const zhValue = entity[field]; // 原始字段通常是中文
    if (zhValue !== null && zhValue !== undefined && zhValue !== '') {
      return zhValue;
    }

    // 最后回退到空字符串
    return '';
  }
}
