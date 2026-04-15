import { Injectable } from '@nestjs/common';
import { BlogService } from '../blog.service';
import { LanguageService } from '@api/common/services/language.service';
import { ArticleStatus } from '@prisma/client';

@Injectable()
export class FrontendBlogService {
  constructor(
    private readonly blogService: BlogService,
    private readonly languageService: LanguageService,
  ) {}

  /**
   * 获取前端博客文章列表（简化版）
   */
  async getFrontendArticles(params: {
    page?: number;
    pageSize?: number;
    categoryId?: string;
    tagId?: string;
    locale?: string;
  }) {
    const {
      page = 1,
      pageSize = 10,
      categoryId,
      tagId,
      locale = 'zh',
    } = params;

    // 调用基础服务获取数据
    const result = await this.blogService.getArticles({
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
      categoryId,
      tagId,
      locale,
    });

    // 转换数据格式为前端专用格式
    return {
      items: result.items.map((article) =>
        this.mapArticleForFrontend(article, locale),
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    };
  }

  /**
   * 根据 Slug 获取前端博客文章详情（简化版）
   */
  async getFrontendArticleBySlug(slug: string, locale: string = 'zh') {
    // 调用基础服务获取文章详情
    const article = await this.blogService.getArticleBySlug(
      slug,
      false,
      locale,
      { processNested: true },
    );

    if (!article) {
      return null;
    }

    // 获取相关文章
    const relatedArticles = await this.blogService.getRelatedArticles(
      article.id,
      5,
    );

    // 转换数据格式
    return {
      ...this.mapArticleForFrontend(article, locale, { includeContent: true }),
      relatedArticles: relatedArticles.map((related) =>
        this.mapArticleForFrontend(related, locale, { includeContent: false }),
      ),
    };
  }

  /**
   * 获取前端博客分类列表（简化版）
   */
  async getFrontendCategories(locale: string = 'zh') {
    const categories = await this.blogService.getCategories();

    return categories.map((category) =>
      this.mapCategoryForFrontend(category, locale),
    );
  }

  /**
   * 根据 Slug 获取前端博客分类详情（简化版）
   */
  async getFrontendCategoryBySlug(
    slug: string,
    params: {
      page?: number;
      pageSize?: number;
      locale?: string;
    },
  ) {
    const { page = 1, pageSize = 10, locale = 'zh' } = params;

    // 获取分类详情及文章
    const result = await this.blogService.getCategoryBySlugWithArticles(slug, {
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
    });

    if (!result) {
      return null;
    }

    // 转换分类数据
    const mappedCategory = this.mapCategoryForFrontend(result.category, locale);

    // 转换文章数据
    const articles = {
      items: result.items.map((article) =>
        this.mapArticleForFrontend(article, locale, { includeContent: false }),
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };

    return {
      ...mappedCategory,
      articles,
    };
  }

  /**
   * 获取前端博客标签列表（简化版）
   */
  async getFrontendTags(locale: string = 'zh') {
    const tags = await this.blogService.getTags();

    return tags.map((tag) => this.mapTagForFrontend(tag, locale));
  }

  /**
   * 根据 Slug 获取前端博客标签详情（简化版）
   */
  async getFrontendTagBySlug(
    slug: string,
    params: {
      page?: number;
      pageSize?: number;
      locale?: string;
    },
  ) {
    const { page = 1, pageSize = 10, locale = 'zh' } = params;

    // 获取标签详情及文章
    const result = await this.blogService.getTagBySlugWithArticles(slug, {
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
    });

    if (!result) {
      return null;
    }

    // 转换标签数据
    const mappedTag = this.mapTagForFrontend(result.tag, locale);

    // 转换文章数据
    const articles = {
      items: result.items.map((article) =>
        this.mapArticleForFrontend(article, locale, { includeContent: false }),
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };

    return {
      ...mappedTag,
      articles,
    };
  }

  /**
   * 获取热门文章（简化版）
   */
  async getFrontendPopularArticles(limit: number = 10, locale: string = 'zh') {
    const articles = await this.blogService.getPopularArticles(limit);

    return articles.map((article) =>
      this.mapArticleForFrontend(article, locale, { includeContent: false }),
    );
  }

  /**
   * 获取相关文章（简化版）
   */
  async getFrontendRelatedArticles(
    articleId: string,
    limit: number = 5,
    locale: string = 'zh',
  ) {
    const articles = await this.blogService.getRelatedArticles(
      articleId,
      limit,
    );

    return articles.map((article) =>
      this.mapArticleForFrontend(article, locale, { includeContent: false }),
    );
  }

  /**
   * 搜索文章（简化版）
   */
  async searchFrontendArticles(
    query: string,
    params: {
      page?: number;
      pageSize?: number;
      locale?: string;
    },
  ) {
    const { page = 1, pageSize = 10, locale = 'zh' } = params;

    const result = await this.blogService.searchArticles(query, {
      page,
      pageSize,
      status: ArticleStatus.PUBLISHED,
    });

    return {
      items: result.items.map((article) =>
        this.mapArticleForFrontend(article, locale, { includeContent: false }),
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    };
  }

  /**
   * 获取博客统计（简化版）
   */
  async getFrontendBlogStats() {
    return this.blogService.getBlogStats();
  }

  /**
   * 获取文章归档（简化版）
   */
  async getFrontendArticleArchive() {
    return this.blogService.getArticleArchive();
  }

  /**
   * 获取热门标签（简化版）
   */
  async getFrontendPopularTags(limit: number = 20) {
    return this.blogService.getPopularTags(limit);
  }

  // ================= 私有辅助方法 =================

  /**
   * 将文章转换为前端专用格式
   */
  private mapArticleForFrontend(
    article: any,
    locale: string,
    options: { includeContent?: boolean } = {},
  ) {
    const { includeContent = false } = options;

    const result: any = {
      id: article.id,
      slug: article.slug,
      title: this.getLocalizedString(article, 'title', locale),
      excerpt: this.getLocalizedString(article, 'excerpt', locale),
      coverImage: this.getLocalizedString(article, 'coverImage', locale),
      views: article.views || 0,
      likes: article.likes || 0,
      commentsCount: article.commentsCount || 0,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
    };

    // 如果需要包含内容
    if (includeContent) {
      result.content = this.getLocalizedString(article, 'content', locale);
      result.contentMd = this.getLocalizedString(article, 'contentMd', locale);
    }

    // 处理分类
    if (article.category) {
      result.category = {
        id: article.category.id,
        name: this.getLocalizedString(article.category, 'name', locale),
        slug: article.category.slug,
      };
    }

    // 处理标签
    if (article.tags && Array.isArray(article.tags)) {
      result.tags = article.tags.map((tag: any) => ({
        id: tag.id,
        name: this.getLocalizedString(tag, 'name', locale),
        slug: tag.slug,
      }));
    }

    // 处理作者
    if (article.author) {
      result.author = {
        id: article.author.id,
        name: article.author.name,
        avatar: article.author.avatar,
      };
    }

    return result;
  }

  /**
   * 将分类转换为前端专用格式
   */
  private mapCategoryForFrontend(category: any, locale: string) {
    return {
      id: category.id,
      name: this.getLocalizedString(category, 'name', locale),
      slug: category.slug,
      description: this.getLocalizedString(category, 'description', locale),
      coverImage: this.getLocalizedString(category, 'coverImage', locale),
      articleCount: category.articleCount || 0,
    };
  }

  /**
   * 将标签转换为前端专用格式
   */
  private mapTagForFrontend(tag: any, locale: string) {
    return {
      id: tag.id,
      name: this.getLocalizedString(tag, 'name', locale),
      slug: tag.slug,
      articleCount: tag.articleCount || 0,
    };
  }

  /**
   * 获取本地化字符串（简化版）
   * 优先返回指定语言，否则返回中文，否则返回空字符串
   * 支持两种格式：
   * 1. 原始格式：字段名为 'name'，Localized字段为 'nameLocalized'
   * 2. 已转换格式：字段 'name' 已经是 Localized 对象
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
