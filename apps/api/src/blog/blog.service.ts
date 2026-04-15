import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ArticleStatus, Prisma } from '@prisma/client';
import { CreateArticleDto, UpdateArticleDto } from './dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Marked } from 'marked';
import type { LocalizedString } from '@lucky/shared';
import { getLocalizedValue, DEFAULT_LOCALE } from '@lucky/shared';
import { SystemConfigService } from '../admin/system-config/system-config.service';
import { LanguageService } from '@api/common/services/language.service';

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);
  private readonly marked: Marked;

  constructor(
    private prisma: PrismaService,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
    private systemConfigService: SystemConfigService,
    private languageService: LanguageService,
  ) {
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

  /**
   * 多语言兼容层: 自动从 Localized 字段或旧字段取值
   */
  private resolveLocalizedField<T>(
    localized: LocalizedString<T> | null | undefined,
    legacyZh: T | null | undefined,
    legacyEn: T | null | undefined,
    locale: string = DEFAULT_LOCALE,
  ): T | undefined {
    // 优先从新 Localized 字段取值
    if (localized) {
      const value = getLocalizedValue(localized, locale as any);
      if (value !== undefined) return value;
    }

    // 回退到旧字段
    if (locale === 'en' && legacyEn !== undefined && legacyEn !== null) {
      return legacyEn;
    }

    // 默认返回中文
    return legacyZh ?? undefined;
  }

  /**
   * 多语言数据构建器: 原生 LocalizedString 架构
   */
  private buildLocalizedData<T>(
    field: LocalizedString<T> | T | null | undefined,
    legacyFieldName: string,
  ): any {
    if (!field) return {};

    const data: any = {};

    //  原生 Localized 格式 - 只写新字段
    if (typeof field === 'object' && !Array.isArray(field)) {
      data[`${legacyFieldName}Localized`] = field;
    }
    // 旧单值格式转换
    else {
      data[`${legacyFieldName}Localized`] = {
        zh: field,
      };
    }

    return data;
  }
  /**
   * 生成唯一 Slug
   */
  async generateUniqueSlug(title: string, excludeId?: string): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 100);

    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.blogArticle.findFirst({
        where: {
          slug,
          id: excludeId ? { not: excludeId } : undefined,
        },
        select: { id: true },
      });

      if (!existing) {
        break;
      }

      slug = `${baseSlug}-${++counter}`;
    }

    return slug;
  }

  /**
   * 创建文章
   */
  async createArticle(authorId: string, dto: CreateArticleDto) {
    let titleValue = '';
    if (
      dto.title &&
      typeof dto.title === 'object' &&
      !Array.isArray(dto.title)
    ) {
      titleValue = getLocalizedValue(dto.title as any, DEFAULT_LOCALE) || '';
    } else if (typeof dto.title === 'string') {
      titleValue = dto.title;
    }
    const slug = await this.generateUniqueSlug(titleValue);

    // 构建 Localized 数据，自动渲染每个语言的 Markdown
    const titleData = this.buildLocalizedData(dto.title, 'title');
    const contentData = this.buildLocalizedData(dto.content, 'content');
    const excerptData = this.buildLocalizedData(dto.excerpt, 'excerpt');
    const coverImageData = this.buildLocalizedData(
      dto.featuredImage,
      'coverImage',
    );

    const article = await this.prisma.blogArticle.create({
      data: {
        slug,
        coverImage: dto.featuredImage,
        status: dto.status || ArticleStatus.DRAFT,
        authorId,
        categoryId:
          dto.categoryId && dto.categoryId.trim() !== ''
            ? dto.categoryId
            : null,
        tags: dto.tagIds
          ? {
              connect: dto.tagIds.map((id) => ({ id })),
            }
          : undefined,
        ...titleData,
        ...contentData,
        ...excerptData,
        ...coverImageData,
      },
      include: {
        category: true,
        tags: true,
      },
    });

    // 异步投递翻译任务，不阻塞请求
    // 使用默认源语言（从系统配置获取，默认为'zh'）
    const defaultSourceLang = await this.systemConfigService.get<string>(
      'blog.translation.defaultSourceLang',
      'zh',
    );

    this.blogAiQueue
      .add('translate-article', {
        articleId: article.id,
        sourceLang: defaultSourceLang,
        targetLang: 'en',
      })
      .catch((err) => {
        // 静默失败，不影响主流程
      });

    return article;
  }

  /**
   * 更新文章
   */
  async updateArticle(
    articleId: string,
    authorId: string,
    dto: UpdateArticleDto,
  ) {
    const article = await this.checkArticleOwner(articleId, authorId);

    let slug = article.slug;
    let newTitle: string | undefined;
    if (
      dto.title &&
      typeof dto.title === 'object' &&
      !Array.isArray(dto.title)
    ) {
      newTitle = getLocalizedValue(dto.title as any, DEFAULT_LOCALE);
    } else if (typeof dto.title === 'string') {
      newTitle = dto.title;
    }
    if (newTitle && newTitle !== article.title) {
      slug = await this.generateUniqueSlug(newTitle, articleId);
    }

    // 构建 Localized 数据
    const titleData =
      dto.title !== undefined
        ? this.buildLocalizedData(dto.title, 'title')
        : {};
    const contentData =
      dto.content !== undefined
        ? this.buildLocalizedData(dto.content, 'content')
        : {};
    const excerptData =
      dto.excerpt !== undefined
        ? this.buildLocalizedData(dto.excerpt, 'excerpt')
        : {};
    const coverImageData =
      dto.featuredImage !== undefined
        ? this.buildLocalizedData(dto.featuredImage, 'coverImage')
        : {};

    const updatedArticle = await this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        slug,
        status: dto.status,
        ...titleData,
        ...contentData,
        ...excerptData,
        ...coverImageData,
        categoryId:
          dto.categoryId !== undefined
            ? dto.categoryId && dto.categoryId.trim() !== ''
              ? dto.categoryId
              : null
            : undefined,
        tags:
          dto.tagIds !== undefined
            ? {
                set: dto.tagIds.map((id) => ({ id })),
              }
            : undefined,
      },
      include: {
        category: true,
        tags: true,
      },
    });

    // 只有标题或内容有变更时才重新翻译
    if (dto.title !== undefined || dto.content !== undefined) {
      const defaultSourceLang = await this.systemConfigService.get<string>(
        'blog.translation.defaultSourceLang',
        'zh',
      );

      this.blogAiQueue
        .add('translate-article', {
          articleId: updatedArticle.id,
          sourceLang: defaultSourceLang,
          targetLang: 'en',
        })
        .catch((err) => {
          // 静默失败
        });
    }

    return updatedArticle;
  }

  /**
   * 检查文章作者权限
   */
  async checkArticleOwner(articleId: string, authorId: string) {
    // 🔓 SuperAdmin 可以跳过所有权检查，操作任何文章
    const adminUser = await this.prisma.adminUser.findUnique({
      where: { id: authorId },
      select: { role: true },
    });

    if (adminUser?.role === 'SUPER_ADMIN') {
      // 超级管理员直接返回完整文章
      const article = await this.prisma.blogArticle.findUnique({
        where: { id: articleId },
      });

      if (!article) {
        throw new NotFoundException('Article not found');
      }

      return article;
    }

    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        authorId: true,
        status: true,
        slug: true,
        title: true,
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    if (article.authorId !== authorId) {
      throw new ForbiddenException('只能编辑自己的文章');
    }

    return article;
  }

  /**
   * 获取文章列表
   */
  async getArticles(params: {
    page?: number;
    pageSize?: number;
    status?: ArticleStatus;
    categoryId?: string;
    tagId?: string;
    authorId?: string;
    search?: string;
    locale?: string;
  }) {
    const {
      page = 1,
      pageSize = 20,
      status,
      categoryId,
      tagId,
      authorId,
      search,
      locale = 'zh',
    } = params;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (search && search.trim()) {
      const searchTerm = search.trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { content: { contains: searchTerm, mode: 'insensitive' } },
        { excerpt: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (tagId) {
      where.tags = {
        some: { id: tagId },
      };
    }

    if (authorId) {
      where.authorId = authorId;
    }

    const [items, total] = await Promise.all([
      this.prisma.blogArticle.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          titleEn: true,
          slug: true,
          excerpt: true,
          excerptEn: true,
          content: true,
          contentMd: true,
          contentEn: true,
          contentMdEn: true,
          coverImage: true,
          status: true,
          viewCount: true,
          commentCount: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          author: { select: { id: true, username: true, realName: true } },
          category: true,
          tags: true,

          // 动态多语言字段
          titleLocalized: true,
          excerptLocalized: true,
          contentLocalized: true,
          contentMdLocalized: true,
          coverImageLocalized: true,
          translationStatus: true,
          translatedAt: true,
        },
      }),
      this.prisma.blogArticle.count({ where }),
    ]);

    // 应用 Localized 转换，传递语言参数
    const mappedItems = items.map((item) =>
      this.mapArticleToLocalized(item, locale),
    );

    return {
      items: mappedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 将数据库文章转换为 Localized 格式 (双向兼容层)
   * 注意：content 字段保持原始格式，因为翻译处理器需要字符串
   */
  private mapArticleToLocalized(
    article: any,
    locale: string = 'zh',
    options: { processNested?: boolean } = {},
  ) {
    const { processNested = false } = options;
    const fields = ['title', 'excerpt', 'coverImage']; // 移除 content 和 contentMd
    const allLocales = ['zh', 'en', 'ja', 'ko', 'fr', 'de'];

    const result = { ...article };

    for (const field of fields) {
      // 处理多种可能的字段格式，但最终返回指定语言的字符串
      const fieldValue = article[field];

      // 构建完整的Localized对象（用于内部处理）
      let localizedObject: Record<string, any> = {};

      // 如果字段已经是对象格式（包含多语言），直接使用
      if (fieldValue && typeof fieldValue === 'object' && fieldValue !== null) {
        localizedObject = { ...fieldValue };
      }

      // 优先从 Localized 字段取值（补充缺失的语言）
      if (result[`${field}Localized`]) {
        Object.assign(localizedObject, result[`${field}Localized`]);
      }

      // 合并所有独立字段，优先级更高（覆盖Localized字段）
      for (const loc of allLocales) {
        const suffix =
          loc === 'zh' ? '' : loc.charAt(0).toUpperCase() + loc.slice(1);
        const dbValue = article[`${field}${suffix}`];

        if (dbValue !== null && dbValue !== undefined) {
          localizedObject[loc] = dbValue;
        }
      }

      // 关键修复：根据请求的语言返回字符串，而不是对象
      // 1. 尝试获取指定语言的值
      if (
        localizedObject[locale] &&
        typeof localizedObject[locale] === 'string'
      ) {
        result[field] = localizedObject[locale];
      }
      // 2. 如果指定语言不存在，尝试获取中文
      else if (
        localizedObject['zh'] &&
        typeof localizedObject['zh'] === 'string'
      ) {
        result[field] = localizedObject['zh'];
      }
      // 3. 如果中文也不存在，尝试获取第一个可用的字符串值
      else {
        const firstStringValue = Object.values(localizedObject).find(
          (v) => typeof v === 'string',
        );
        result[field] = firstStringValue || '';
      }

      // 保留完整的Localized对象在单独的字段中（如果需要）
      if (Object.keys(localizedObject).length > 0) {
        result[`${field}LocalizedFull`] = localizedObject;
      }
    }

    // 如果需要处理嵌套的分类和标签对象
    if (processNested) {
      if (result.category) {
        result.category = this.mapCategoryToLocalized(result.category, locale);
      }
      if (result.tags && Array.isArray(result.tags)) {
        result.tags = result.tags.map((tag: any) =>
          this.mapTagToLocalized(tag, locale),
        );
      }
    }

    return result;
  }

  /**
   * 将数据库分类转换为标准 Localized 格式
   * 修复错误格式：{ en: { zh: "..." }, zh: "..." } → { en: "...", zh: "..." }
   * 支持根据语言返回字符串或完整对象
   */
  private mapCategoryToLocalized(category: any, locale?: string) {
    if (!category) return category;

    const result = { ...category };
    const fields = ['name', 'description'];

    for (const field of fields) {
      const fieldValue = result[field];

      // 如果字段不存在或为空，跳过
      if (!fieldValue) continue;

      // 如果已经是JSON对象，检查并修复嵌套格式
      if (typeof fieldValue === 'object' && fieldValue !== null) {
        const fixedValue = { ...fieldValue };

        // 修复嵌套错误格式：{ en: { zh: "..." } } → { en: "..." }
        for (const lang of Object.keys(fixedValue)) {
          const langValue = fixedValue[lang];
          if (
            langValue &&
            typeof langValue === 'object' &&
            langValue !== null
          ) {
            // 如果是嵌套对象，提取第一个字符串值
            const firstStringValue = Object.values(langValue).find(
              (v) => typeof v === 'string',
            );
            if (firstStringValue) {
              fixedValue[lang] = firstStringValue;
            }
          }
        }

        // 如果指定了语言，返回该语言的字符串
        if (locale && fixedValue[locale] && typeof fixedValue[locale] === 'string') {
          result[field] = fixedValue[locale];
        } else {
          result[field] = fixedValue;
        }
      }
      // 如果是字符串，转换为JSON对象格式
      else if (typeof fieldValue === 'string') {
        if (locale === 'zh') {
          result[field] = fieldValue; // 如果是中文，直接返回字符串
        } else {
          result[field] = { zh: fieldValue };
        }
      }
    }

    return result;
  }

  /**
   * 将数据库标签转换为标准 Localized 格式
   * 修复错误格式：{ en: { zh: "..." }, zh: "..." } → { en: "...", zh: "..." }
   * 支持根据语言返回字符串或完整对象
   */
  private mapTagToLocalized(tag: any, locale?: string) {
    if (!tag) return tag;

    const result = { ...tag };
    const fields = ['name', 'description'];

    for (const field of fields) {
      const fieldValue = result[field];

      // 如果字段不存在或为空，跳过
      if (!fieldValue) continue;

      // 如果已经是JSON对象，检查并修复嵌套格式
      if (typeof fieldValue === 'object' && fieldValue !== null) {
        const fixedValue = { ...fieldValue };

        // 修复嵌套错误格式：{ en: { zh: "..." } } → { en: "..." }
        for (const lang of Object.keys(fixedValue)) {
          const langValue = fixedValue[lang];
          if (
            langValue &&
            typeof langValue === 'object' &&
            langValue !== null
          ) {
            // 如果是嵌套对象，提取第一个字符串值
            const firstStringValue = Object.values(langValue).find(
              (v) => typeof v === 'string',
            );
            if (firstStringValue) {
              fixedValue[lang] = firstStringValue;
            }
          }
        }

        // 如果指定了语言，返回该语言的字符串
        if (locale && fixedValue[locale] && typeof fixedValue[locale] === 'string') {
          result[field] = fixedValue[locale];
        } else {
          result[field] = fixedValue;
        }
      }
      // 如果是字符串，转换为JSON对象格式
      else if (typeof fieldValue === 'string') {
        if (locale === 'zh') {
          result[field] = fieldValue; // 如果是中文，直接返回字符串
        } else {
          result[field] = { zh: fieldValue };
        }
      }
    }

    return result;
  }

  /**
   * 获取文章详情
   */
  async getArticle(id: string, incrementView = false) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, username: true, realName: true } },
        category: true,
        tags: true,
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    if (incrementView) {
      // 异步更新浏览次数，不阻塞请求
      this.prisma.blogArticle
        .update({
          where: { id },
          data: { viewCount: { increment: 1 } },
        })
        .catch(() => {
          // 静默失败
        });
    }

    // 应用 Localized 双向兼容转换并返回
    const mapped = this.mapArticleToLocalized(article);
    this.logger.debug('Mapped article for edit:', {
      id: mapped.id,
      title: mapped.title,
      content: mapped.content,
      excerpt: mapped.excerpt,
    });
    return mapped;
  }

  /**
   * 通过 Slug 获取文章
   */
  async getArticleBySlug(
    slug: string,
    incrementView = false,
    locale: string = 'zh',
    options: { processNested?: boolean } = {},
  ) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
      include: {
        author: { select: { id: true, username: true, realName: true } },
        category: true,
        tags: true,
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found');
    }

    if (incrementView) {
      this.prisma.blogArticle
        .update({
          where: { slug },
          data: { viewCount: { increment: 1 } },
        })
        .catch(() => {});
    }

    // 应用 Localized 双向兼容转换并返回，传递语言参数和处理选项
    return this.mapArticleToLocalized(article, locale, options);
  }

  /**
   * 删除文章
   */
  async deleteArticle(articleId: string, authorId: string) {
    await this.checkArticleOwner(articleId, authorId);

    return this.prisma.blogArticle.delete({
      where: { id: articleId },
    });
  }

  /**
   * 发布文章
   */
  async publishArticle(articleId: string, authorId: string) {
    await this.checkArticleOwner(articleId, authorId);

    return this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
  }

  /**
   * 取消发布文章（设为草稿）
   */
  async unpublishArticle(articleId: string, authorId: string) {
    await this.checkArticleOwner(articleId, authorId);

    return this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        status: ArticleStatus.DRAFT,
        publishedAt: null,
      },
    });
  }

  /**
   * 手动触发文章翻译
   */
  async translateArticle(
    articleId: string,
    authorId: string,
    targetLang?: string,
  ) {
    await this.checkArticleOwner(articleId, authorId);

    // 投递翻译任务到队列
    await this.blogAiQueue.add('translate-article', {
      articleId,
      targetLang: targetLang || 'en',
    });

    return {
      success: true,
      message: `Translation task queued for article ${articleId}`,
      targetLang: targetLang || 'en',
    };
  }

  /**
   * 翻译分类
   */
  async translateCategory(categoryId: string, targetLang?: string) {
    // 投递翻译任务到队列
    await this.blogAiQueue.add('translate-category', {
      categoryId,
      targetLang: targetLang || 'en',
    });

    return {
      success: true,
      message: `Translation task queued for category ${categoryId}`,
      targetLang: targetLang || 'en',
    };
  }

  /**
   * 翻译标签
   */
  async translateTag(tagId: string, targetLang?: string) {
    // 投递翻译任务到队列
    await this.blogAiQueue.add('translate-tag', {
      tagId,
      targetLang: targetLang || 'en',
    });

    return {
      success: true,
      message: `Translation task queued for tag ${tagId}`,
      targetLang: targetLang || 'en',
    };
  }

  /**
   * 批量初始化语言翻译
   * 当开启新语言时，自动翻译所有文章、分类和标签
   */
  async initializeLanguageTranslations(languageCode: string) {
    this.logger.log(`Initializing translations for language: ${languageCode}`);

    // 获取默认源语言
    const defaultSourceLang = await this.getDefaultSourceLang();

    // 1. 扫描所有文章
    const articles = await this.prisma.blogArticle.findMany({
      select: { id: true },
    });

    for (const article of articles) {
      await this.blogAiQueue.add('translate-article', {
        articleId: article.id,
        targetLang: languageCode,
        sourceLang: defaultSourceLang,
      });
    }

    // 2. 扫描所有分类
    const categories = await this.prisma.blogCategory.findMany({
      select: { id: true },
    });

    for (const category of categories) {
      await this.blogAiQueue.add('translate-category', {
        categoryId: category.id,
        targetLang: languageCode,
        sourceLang: defaultSourceLang,
      });
    }

    // 3. 扫描所有标签
    const tags = await this.prisma.blogTag.findMany({
      select: { id: true },
    });

    for (const tag of tags) {
      await this.blogAiQueue.add('translate-tag', {
        tagId: tag.id,
        targetLang: languageCode,
        sourceLang: defaultSourceLang,
      });
    }

    return {
      success: true,
      message: `Translation tasks queued for language ${languageCode}`,
      articles: articles.length,
      categories: categories.length,
      tags: tags.length,
    };
  }

  /**
   * 获取博客统计数据
   */
  async getBlogStats() {
    const [
      totalArticles,
      totalCategories,
      totalTags,
      totalViews,
      totalComments,
    ] = await Promise.all([
      this.prisma.blogArticle.count({
        where: { status: ArticleStatus.PUBLISHED },
      }),
      this.prisma.blogCategory.count(),
      this.prisma.blogTag.count(),
      this.prisma.blogArticle.aggregate({ _sum: { viewCount: true } }),
      this.prisma.blogComment.count(),
    ]);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyPublishes = await this.prisma.blogArticle.count({
      where: {
        status: ArticleStatus.PUBLISHED,
        publishedAt: { gte: oneWeekAgo },
      },
    });

    return {
      totalArticles,
      totalCategories,
      totalTags,
      totalViews: totalViews._sum.viewCount || 0,
      totalComments,
      weeklyPublishes,
    };
  }

  /**
   * 获取热门标签
   */
  async getPopularTags(limit: number) {
    return this.prisma.blogTag.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 获取文章归档
   */
  async getArticleArchive() {
    const articles = await this.prisma.blogArticle.findMany({
      where: { status: ArticleStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        slug: true,
        publishedAt: true,
        createdAt: true,
      },
      orderBy: { publishedAt: 'desc' },
    });

    const archive: Record<string, any> = {};

    articles.forEach((article) => {
      const date = article.publishedAt || article.createdAt;
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;

      if (!archive[key]) {
        archive[key] = {
          year,
          month,
          count: 0,
          articles: [],
        };
      }

      archive[key].count++;
      archive[key].articles.push(article);
    });

    return Object.values(archive);
  }

  /**
   * 文章点赞
   */
  async likeArticle(slug: string, fingerprint: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('Article not found');

    // 这里后续可以添加指纹去重逻辑
    return this.prisma.blogArticle.update({
      where: { slug },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    });
  }

  /**
   * 监听语言启用事件，自动触发全库翻译
   */
  @OnEvent('locale.enabled')
  async handleLocaleEnabled(targetLang: string) {
    this.logger.log(`🔔 Received locale enabled event: ${targetLang}`);
    return this.queueFullLocaleTranslation(targetLang);
  }

  /**
   * 为特定语言批量投递全库翻译任务
   */
  async queueFullLocaleTranslation(targetLang: string) {
    // 获取默认源语言
    const defaultSourceLang = await this.getDefaultSourceLang();

    // 扫描所有缺少该语言翻译的文章 - 原生SQL绕过Prisma JSON查询缺陷
    // 注意: PostgreSQL大小写敏感，驼峰字段必须加双引号！
    const articles = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM blog_articles 
      WHERE 
        "titleLocalized" IS NULL 
        OR "titleLocalized" = 'null'::jsonb 
        OR "titleLocalized"->${targetLang} IS NULL 
        OR jsonb_typeof("titleLocalized"->${targetLang}) = 'null'
    `;

    // 扫描所有缺少该语言翻译的分类 - 使用现有的name字段（已经是JSON类型）
    const categories = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM blog_categories 
      WHERE 
        "name" IS NULL 
        OR "name" = 'null'::jsonb 
        OR "name"->${targetLang} IS NULL 
        OR jsonb_typeof("name"->${targetLang}) = 'null'
    `;

    // 扫描所有缺少该语言翻译的标签 - 使用现有的name字段（已经是JSON类型）
    const tags = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM blog_tags 
      WHERE 
        "name" IS NULL 
        OR "name" = 'null'::jsonb 
        OR "name"->${targetLang} IS NULL 
        OR jsonb_typeof("name"->${targetLang}) = 'null'
    `;

    this.logger.log(
      `Found ${articles.length} articles, ${categories.length} categories, ${tags.length} tags to translate to ${targetLang}`,
    );

    let totalJobs = 0;

    // 批量投递文章翻译任务到队列，每个Job间隔600ms适配Gemini限流
    for (const [index, article] of articles.entries()) {
      await this.blogAiQueue.add(
        'translate-article',
        {
          articleId: article.id,
          targetLang,
          sourceLang: defaultSourceLang,
        },
        {
          delay: index * 600, // ⬆️ 间隔600ms（更保守，每分钟约100个任务）
          attempts: 2, // 最多重试2次
          backoff: {
            type: 'exponential',
            delay: 5000, // 第一次重试5秒后
          },
          removeOnComplete: true, // 完成后移除任务
        },
      );
      totalJobs++;
    }

    // 批量投递分类翻译任务到队列
    for (const [index, category] of categories.entries()) {
      await this.blogAiQueue.add(
        'translate-category',
        {
          categoryId: category.id,
          targetLang,
          sourceLang: defaultSourceLang,
        },
        {
          delay: (articles.length + index) * 600, // 从文章任务之后继续600ms间隔
          attempts: 2, // 最多重试2次
          backoff: {
            type: 'exponential',
            delay: 5000, // 第一次重试5秒后
          },
          removeOnComplete: true, // 完成后移除任务
        },
      );
      totalJobs++;
    }

    // 批量投递标签翻译任务到队列
    for (const [index, tag] of tags.entries()) {
      await this.blogAiQueue.add(
        'translate-tag',
        {
          tagId: tag.id,
          targetLang,
          sourceLang: defaultSourceLang,
        },
        {
          delay: (articles.length + categories.length + index) * 600, // 从文章和分类任务之后继续600ms间隔
          attempts: 2, // 最多重试2次
          backoff: {
            type: 'exponential',
            delay: 5000, // 第一次重试5秒后
          },
          removeOnComplete: true, // 完成后移除任务
        },
      );
      totalJobs++;
    }

    return {
      total: totalJobs,
      articles: articles.length,
      categories: categories.length,
      tags: tags.length,
      targetLang,
    };
  }

  /**
   * 取消文章点赞
   */
  async unlikeArticle(slug: string, fingerprint: string) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('Article not found');

    return this.prisma.blogArticle.update({
      where: { slug },
      data: { likeCount: { decrement: 1 } },
      select: { likeCount: true },
    });
  }

  /**
   * 检查点赞状态
   */
  async checkLikeStatus(slug: string, fingerprint: string) {
    // 后续实现指纹检查逻辑
    return { liked: false };
  }

  /**
   * 创建评论
   */
  async createComment(slug: string, dto: any, userId?: string | null) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('Article not found');

    const commentData: any = {
      articleId: article.id,
      content: dto.content,
      parentId: dto.parentId,
    };

    if (userId) {
      commentData.userId = userId;
    } else {
      commentData.author = dto.author;
      commentData.email = dto.email;
      commentData.website = dto.website;
    }

    const comment = await this.prisma.blogComment.create({
      data: commentData,
    });

    // 更新文章评论计数
    await this.prisma.blogArticle.update({
      where: { id: article.id },
      data: { commentCount: { increment: 1 } },
    });

    return comment;
  }

  /**
   * 获取热门文章
   */
  async getPopularArticles(limit = 10) {
    return this.prisma.blogArticle.findMany({
      where: { status: ArticleStatus.PUBLISHED },
      orderBy: { viewCount: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        viewCount: true,
        publishedAt: true,
      },
    });
  }

  /**
   * 获取相关文章
   */
  async getRelatedArticles(articleId: string, limit = 5) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      include: { tags: true },
    });

    if (!article) throw new NotFoundException('Article not found');

    const tagIds = article.tags.map((t) => t.id);

    return this.prisma.blogArticle.findMany({
      where: {
        id: { not: articleId },
        status: ArticleStatus.PUBLISHED,
        tags: { some: { id: { in: tagIds } } },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        slug: true,
        coverImage: true,
        publishedAt: true,
      },
    });
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    const categories = await this.prisma.blogCategory.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // 应用Localized格式转换
    return categories.map((category) => this.mapCategoryToLocalized(category));
  }

  /**
   * 按Slug获取分类及文章
   */
  async getCategoryBySlugWithArticles(slug: string, params: any) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { slug },
    });
    if (!category) throw new NotFoundException('分类不存在');

    const articles = await this.getArticles({
      ...params,
      categoryId: category.id,
    });

    return { category, ...articles };
  }

  /**
   * 获取标签列表
   */
  async getTags() {
    const tags = await this.prisma.blogTag.findMany({
      orderBy: { name: 'asc' },
    });

    // 应用Localized格式转换
    return tags.map((tag) => this.mapTagToLocalized(tag));
  }

  /**
   * 按Slug获取标签及文章
   */
  async getTagBySlugWithArticles(slug: string, params: any) {
    const tag = await this.prisma.blogTag.findUnique({ where: { slug } });
    if (!tag) throw new NotFoundException('Tag not found');

    const articles = await this.getArticles({
      ...params,
      tagId: tag.id,
    });

    return { tag, ...articles };
  }

  /**
   * 获取文章评论
   */
  async getArticleComments(slug: string, params: any) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('Article not found');

    const { page = 1, pageSize = 20 } = params;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.blogComment.findMany({
        where: { articleId: article.id },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.blogComment.count({
        where: { articleId: article.id },
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
   * 搜索文章
   */
  async searchArticles(query: string, params: any) {
    return this.getArticles({
      ...params,
      search: query,
    });
  }

  /**
   * 获取默认源语言
   */
  private async getDefaultSourceLang(): Promise<string> {
    return this.systemConfigService.get<string>(
      'blog.translation.defaultSourceLang',
      'zh',
    );
  }

  /**
   * 获取翻译进度统计
   */
  async getTranslationProgress() {
    // 获取当前启用的语言
    const enabledLocales = await this.systemConfigService.get<string[]>(
      'enabled_locales',
      ['zh'],
    );

    // 查找需要翻译的目标语言（排除源语言）
    const sourceLang = await this.getDefaultSourceLang();
    const targetLangs = enabledLocales.filter((lang) => lang !== sourceLang);

    if (targetLangs.length === 0) {
      return {
        totalItems: 0,
        completedItems: 0,
        failedItems: 0,
        inProgressItems: 0,
        articles: { total: 0, completed: 0, failed: 0, pending: 0 },
        categories: { total: 0, completed: 0, failed: 0, pending: 0 },
        tags: { total: 0, completed: 0, failed: 0, pending: 0 },
        queueStatus: { active: 0, waiting: 0, failed: 0, completed: 0 },
        startTime: null,
        estimatedCompletionTime: null,
        elapsedTime: 0,
      };
    }

    // 假设我们只处理第一个目标语言（通常是en）
    const targetLang = targetLangs[0];

    // 查询文章翻译统计
    const [articles, categories, tags] = await Promise.all([
      this.getArticleTranslationStats(targetLang),
      this.getCategoryTranslationStats(targetLang),
      this.getTagTranslationStats(targetLang),
    ]);

    // 查询队列状态
    const queueStatus = await this.getQueueStatus();

    // 计算总体统计
    const totalItems = articles.total + categories.total + tags.total;
    const completedItems =
      articles.completed + categories.completed + tags.completed;
    const failedItems = articles.failed + categories.failed + tags.failed;
    const inProgressItems =
      articles.pending + categories.pending + tags.pending;

    // 估算完成时间（假设每个任务平均5秒）
    const estimatedCompletionTime = new Date();
    estimatedCompletionTime.setSeconds(
      estimatedCompletionTime.getSeconds() + inProgressItems * 5,
    );

    return {
      totalItems,
      completedItems,
      failedItems,
      inProgressItems,
      articles,
      categories,
      tags,
      queueStatus,
      startTime: new Date(), // 实际应该从队列开始时间获取
      estimatedCompletionTime,
      elapsedTime: 0, // 实际应该计算
    };
  }

  /**
   * 获取文章翻译统计
   */
  private async getArticleTranslationStats(targetLang: string) {
    // 查询需要翻译的文章总数
    const total = await this.prisma.blogArticle.count({
      where: {
        status: { not: 'DRAFT' },
      },
    });

    // 查询已完成翻译的文章 - 使用原生 SQL 查询避免 Prisma JSON 查询问题
    const completedResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM blog_articles 
      WHERE status != 'DRAFT' 
        AND "translationStatus" = 'COMPLETED'
        AND "titleLocalized" IS NOT NULL 
        AND "titleLocalized" != 'null'::jsonb 
        AND "titleLocalized"->>${targetLang} IS NOT NULL 
        AND "titleLocalized"->>${targetLang} != ''
    `;

    const completed = Number(completedResult[0]?.count || 0);

    // 查询翻译失败的文章
    const failed = await this.prisma.blogArticle.count({
      where: {
        status: { not: 'DRAFT' },
        translationStatus: 'FAILED',
      },
    });

    // 查询正在翻译的文章
    const pending = await this.prisma.blogArticle.count({
      where: {
        status: { not: 'DRAFT' },
        translationStatus: 'TRANSLATING',
      },
    });

    return {
      total,
      completed,
      failed,
      pending,
    };
  }

  /**
   * 获取分类翻译统计
   */
  private async getCategoryTranslationStats(targetLang: string) {
    const total = await this.prisma.blogCategory.count();

    // 查询已完成翻译的分类 - 使用原生 SQL 查询避免 Prisma JSON 查询问题
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM blog_categories 
      WHERE name IS NOT NULL 
        AND name != 'null'::jsonb 
        AND name->>${targetLang} IS NOT NULL 
        AND name->>${targetLang} != ''
    `;

    const completed = Number(result[0]?.count || 0);

    return {
      total,
      completed,
      failed: 0, // 分类翻译没有失败状态
      pending: total - completed,
    };
  }

  /**
   * 获取标签翻译统计
   */
  private async getTagTranslationStats(targetLang: string) {
    const total = await this.prisma.blogTag.count();

    // 查询已完成翻译的标签 - 使用原生 SQL 查询避免 Prisma JSON 查询问题
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM blog_tags 
      WHERE name IS NOT NULL 
        AND name != 'null'::jsonb 
        AND name->>${targetLang} IS NOT NULL 
        AND name->>${targetLang} != ''
    `;

    const completed = Number(result[0]?.count || 0);

    return {
      total,
      completed,
      failed: 0, // 标签翻译没有失败状态
      pending: total - completed,
    };
  }

  /**
   * 获取队列状态
   */
  private async getQueueStatus() {
    try {
      const [active, waiting, failed, completed] = await Promise.all([
        this.blogAiQueue.getActiveCount(),
        this.blogAiQueue.getWaitingCount(),
        this.blogAiQueue.getFailedCount(),
        this.blogAiQueue.getCompletedCount(),
      ]);

      return {
        active,
        waiting,
        failed,
        completed,
      };
    } catch (error) {
      this.logger.error('获取队列状态失败', error);
      return {
        active: 0,
        waiting: 0,
        failed: 0,
        completed: 0,
      };
    }
  }

  /**
   * 获取翻译任务列表
   */
  async getTranslationJobs() {
    try {
      // 自动清理超过24小时的已完成任务和失败任务
      try {
        const gracePeriod = 1000 * 60 * 60 * 24; // 24小时
        const [cleanedCompleted, cleanedFailed] = await Promise.all([
          this.blogAiQueue
            .clean(gracePeriod, 1000, 'completed')
            .catch(() => []),
          this.blogAiQueue.clean(gracePeriod, 1000, 'failed').catch(() => []),
        ]);

        const completedCount = Array.isArray(cleanedCompleted)
          ? cleanedCompleted.length
          : 0;
        const failedCount = Array.isArray(cleanedFailed)
          ? cleanedFailed.length
          : 0;

        if (completedCount > 0 || failedCount > 0) {
          this.logger.debug(
            `自动清理了 ${completedCount} 个已完成任务和 ${failedCount} 个失败任务`,
          );
        }
      } catch (cleanError) {
        this.logger.warn('自动清理任务失败，继续获取任务列表', cleanError);
      }

      const [activeJobs, waitingJobs, failedJobs] = await Promise.all([
        this.blogAiQueue.getActive(),
        this.blogAiQueue.getWaiting(),
        this.blogAiQueue.getFailed(),
      ]);

      // 格式化任务信息
      const formatJob = (job: any) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
      });

      return {
        active: activeJobs.map(formatJob),
        waiting: waitingJobs.map(formatJob),
        failed: failedJobs.map(formatJob),
      };
    } catch (error) {
      this.logger.error('获取翻译任务列表失败', error);
      return {
        active: [],
        waiting: [],
        failed: [],
      };
    }
  }

  /**
   * 获取翻译日志
   */
  async getTranslationLogs(params: { page: number; pageSize: number }) {
    const { page = 1, pageSize = 20 } = params;
    const skip = (page - 1) * pageSize;

    // 这里可以查询数据库中的翻译日志表
    // 暂时返回空数组，后续可以扩展
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
    };
  }

  /**
   * 检测翻译问题
   */
  async detectTranslationIssues(languageCode?: string) {
    this.logger.log(`开始检测翻译问题，语言: ${languageCode || '所有'}`);

    try {
      // 获取所有文章
      const articles = await this.prisma.blogArticle.findMany({
        select: {
          id: true,
          title: true,
          titleLocalized: true,
          contentLocalized: true,
          excerptLocalized: true,
          translationStatus: true,
        },
      });

      const issues = [];

      for (const article of articles) {
        const articleIssues = this.detectArticleTranslationIssues(
          article,
          languageCode,
        );
        if (articleIssues.length > 0) {
          issues.push({
            articleId: article.id,
            articleTitle: article.title,
            issues: articleIssues,
          });
        }
      }

      this.logger.log(`检测完成，发现 ${issues.length} 篇文章有翻译问题`);
      return {
        success: true,
        totalArticles: articles.length,
        problematicArticles: issues.length,
        issues,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('检测翻译问题失败', error);
      throw error;
    }
  }

  /**
   * 检测单篇文章的翻译问题
   */
  private detectArticleTranslationIssues(
    article: any,
    languageCode?: string,
  ): any[] {
    const issues = [];
    const targetLanguages = languageCode ? [languageCode] : ['en', 'ja']; // 默认检查英语和日语

    for (const lang of targetLanguages) {
      // 1. 检查标题是否未翻译
      const titleEn = article.titleLocalized?.[lang];
      const titleZh = article.titleLocalized?.zh;
      if (titleEn && titleZh && titleEn === titleZh) {
        issues.push({
          language: lang,
          issueType: 'TITLE_NOT_TRANSLATED',
          severity: 'HIGH',
          description: `${lang.toUpperCase()}标题与中文标题完全相同，未翻译`,
        });
      }

      // 2. 检查内容是否完整
      const contentEn = article.contentLocalized?.[lang] || '';
      const contentZh = article.contentLocalized?.zh || '';
      if (contentZh && contentEn.length < contentZh.length * 0.3) {
        issues.push({
          language: lang,
          issueType: 'CONTENT_INCOMPLETE',
          severity: 'MEDIUM',
          description: `${lang.toUpperCase()}内容不完整（${contentEn.length}/${contentZh.length}字符）`,
        });
      }

      // 3. 检查是否有翻译
      if (
        !article.titleLocalized?.[lang] ||
        !article.contentLocalized?.[lang]
      ) {
        issues.push({
          language: lang,
          issueType: 'NOT_TRANSLATED',
          severity: 'HIGH',
          description: `缺少${lang.toUpperCase()}翻译`,
        });
      }

      // 4. 检查翻译状态
      if (article.translationStatus === 'FAILED') {
        issues.push({
          language: lang,
          issueType: 'TRANSLATION_FAILED',
          severity: 'HIGH',
          description: `${lang.toUpperCase()}翻译失败`,
        });
      }
    }

    return issues;
  }

  /**
   * 批量修复翻译问题
   */
  async fixTranslationIssuesBatch(params: {
    articleIds?: string[];
    languageCode?: string;
    issueTypes?: string[];
  }) {
    const { articleIds, languageCode = 'en', issueTypes } = params;

    this.logger.log(`开始批量修复翻译问题，语言: ${languageCode}`);

    try {
      // 如果没有指定文章ID，则检测所有有问题的文章
      let targetArticles = [];
      if (articleIds && articleIds.length > 0) {
        // 获取指定文章
        targetArticles = await this.prisma.blogArticle.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, title: true },
        });
      } else {
        // 检测有问题的文章
        const issuesResult = await this.detectTranslationIssues(languageCode);
        targetArticles = issuesResult.issues.map((issue) => ({
          id: issue.articleId,
          title: issue.articleTitle,
        }));
      }

      if (targetArticles.length === 0) {
        return {
          success: true,
          message: '没有需要修复的文章',
          total: 0,
          queued: 0,
        };
      }

      // 批量投递翻译任务
      let queuedCount = 0;
      for (const article of targetArticles) {
        try {
          await this.blogAiQueue.add('translate-article', {
            articleId: article.id,
            targetLang: languageCode,
            sourceLang: 'zh',
            priority: 1, // 高优先级
            isRetry: true, // 标记为重试
          });
          queuedCount++;
          this.logger.debug(`已投递修复任务: ${article.id} - ${article.title}`);
        } catch (error) {
          this.logger.error(`投递修复任务失败: ${article.id}`, error);
        }
      }

      this.logger.log(`批量修复完成，已投递 ${queuedCount} 个任务`);
      return {
        success: true,
        message: `已投递 ${queuedCount} 个修复任务`,
        total: targetArticles.length,
        queued: queuedCount,
        languageCode,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('批量修复翻译问题失败', error);
      throw error;
    }
  }

  /**
   * 获取启用语言列表
   */
  async getEnabledLanguages() {
    try {
      const enabledLocales = await this.systemConfigService.get<string[]>(
        'enabled_locales',
        ['zh'],
      );
      return {
        success: true,
        languages: enabledLocales,
        defaultSourceLang: await this.getDefaultSourceLang(),
      };
    } catch (error) {
      this.logger.error('获取启用语言列表失败', error);
      return {
        success: false,
        languages: ['zh'],
        defaultSourceLang: 'zh',
      };
    }
  }
}
