import { Injectable, Logger } from '@nestjs/common';
import { BlogService } from '../blog.service';
import { LanguageService } from '@api/common/services/language.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ArticleStatus } from '@prisma/client';

@Injectable()
export class FrontendBlogService {
  private readonly logger = new Logger(FrontendBlogService.name);

  constructor(
    private readonly blogService: BlogService,
    private readonly languageService: LanguageService,
    private readonly prisma: PrismaService,
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
   * 获取精选文章列表（featured = true）
   * 用于首页 Hero 区域展示
   */
  async getFrontendFeaturedArticles(locale: string = 'zh') {
    const articles = await this.prisma.blogArticle.findMany({
      where: {
        featured: true,
        status: ArticleStatus.PUBLISHED,
      },
      orderBy: { publishedAt: 'desc' },
      take: 6, // 最多展示6篇精选文章
      select: {
        id: true,
        slug: true,
        title: true,
        titleEn: true,
        excerpt: true,
        excerptEn: true,
        coverImage: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        publishedAt: true,
        updatedAt: true,
        featured: true,
        meta: true,
        titleLocalized: true,
        excerptLocalized: true,
        coverImageLocalized: true,
        category: {
          select: { id: true, name: true, slug: true },
        },
        tags: {
          select: { id: true, name: true, slug: true },
        },
        author: {
          select: { id: true, username: true, realName: true },
        },
      },
    });

    return articles.map((article) =>
      this.mapArticleForFrontend(article, locale),
    );
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
      featured: article.featured ?? false,
      title: this.getLocalizedString(article, 'title', locale),
      excerpt: this.getLocalizedString(article, 'excerpt', locale),
      coverImage: this.getLocalizedString(article, 'coverImage', locale),
      views: article.viewCount ?? article.views ?? 0,
      likes: article.likeCount ?? article.likes ?? 0,
      commentsCount: article.commentCount ?? article.commentsCount ?? 0,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
    };

    // Include rich media meta (blurhash, image variants, video HLS)
    if (article.meta) {
      result.meta = article.meta;
    }

    // 如果需要包含内容
    if (includeContent) {
      // 获取本地化内容（不含视频后处理，保持原始状态）
      result.content = this.getLocalizedString(article, 'content', locale, { skipVideoInjection: true });
      result.contentMd = this.getLocalizedString(article, 'contentMd', locale, { skipVideoInjection: true });

      // 关键修复：始终执行视频位置智能注入（如果 content 包含视频）
      // 即使 contentMd 已经有视频（通常在末尾），也重新注入到正确位置
      // 通过 HTML 里视频前面的标题定位，在 Markdown 对应标题后插入，保持阅读顺序正确
      // 这样前端可以始终用 contentMd（保留代码高亮），视频也出现在正确位置
      if (result.content && /<video[\s\S]*?<\/video>/i.test(result.content)) {
        // 如果 contentMd 不存在或为空，用 content 作为基础
        const baseMd = result.contentMd || result.content || '';
        result.contentMd = this.injectVideosIntoMarkdown(
          baseMd,
          result.content,
        );
      }
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
        avatar: null, // AdminUser 没有 avatar 字段
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
      articleCount: category._count?.articles ?? category.articleCount ?? 0,
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
      articleCount: tag._count?.articles ?? tag.articleCount ?? 0,
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
    options: { skipVideoInjection?: boolean } = {},
  ): string {
    const { skipVideoInjection = false } = options;
    // 首先检查字段本身是否已经是 Localized 对象
    const fieldValue = entity[field];
    // 如果字段本身就是 Localized 对象（如 {en: "...", zh: "..."}）
    if (fieldValue && typeof fieldValue === 'object' && fieldValue !== null) {
      // 优先返回指定语言的值（使用显式非空字符串检查，避免空字符串被当作 falsy 跳过）
      if (typeof fieldValue[locale] === 'string' && fieldValue[locale] !== '') {
        return fieldValue[locale];
      }
      // 回退到中文
      if (typeof fieldValue['zh'] === 'string' && fieldValue['zh'] !== '') {
        return fieldValue['zh'];
      }
      // 回退到第一个可用的非空字符串值
      const firstStringValue = Object.values(fieldValue).find(
        (v): v is string => typeof v === 'string' && v !== '',
      );
      if (firstStringValue) {
        return firstStringValue;
      }
      // 修复：如果所有值都是空字符串，返回空字符串而不是原始 {en, zh} 对象
      // 避免前端渲染时出现 "Objects are not valid as a React child" 错误
      return '';
    }

    // 检查 Localized 字段（原始格式）
    const localizedField = entity[`${field}Localized`];

    if (localizedField && localizedField[locale]) {
      // Fix: For content/contentMd fields, preserve video/figure HTML tags from original
      // HTML content when the localized version (AI-translated text) is missing them.
      // The translation processor saves only rendered markdown text, losing video tags.
      // 仅在未设置 skipVideoInjection 时才执行视频追加（会追加到末尾）
      if (!skipVideoInjection && (field === 'content' || field === 'contentMd')) {
        // Always extract videos from the HTML source (contentLocalized['zh'] or entity['content']),
        // because contentMd is plain Markdown and never contains <video> tags.
        const htmlSource =
          (entity['contentLocalized'] as any)?.['zh'] ||
          entity['content'] ||
          '';
        const localizedValue = localizedField[locale];
        if (
          htmlSource &&
          typeof htmlSource === 'string' &&
          typeof localizedValue === 'string' &&
          /<video[\s\S]*?<\/video>/i.test(htmlSource) &&
          !/<video[\s\S]*?<\/video>/i.test(localizedValue)
        ) {
          // Extract video blocks (Quill video tags - <video> with <source>, may or may not have figure wrapper)
          const videoBlocks = htmlSource.match(
            /<figure[^>]*>[\s\S]*?<video[\s\S]*?<\/video>[\s\S]*?<\/figure>|<video[\s\S]*?<\/video>/gi,
          );
          if (videoBlocks && videoBlocks.length > 0) {
            // Append video blocks to end of the translated text
            // rehypeRaw plugin supports raw HTML in Markdown, so this works for both paths
            return localizedValue + '\n\n' + videoBlocks.join('\n\n');
          }
        }
      }
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
    // 修复：只返回非空字符串，避免返回原始 {en, zh} 对象
    if (typeof zhValue === 'string' && zhValue !== '') {
      return zhValue;
    }

    // 最后回退到空字符串
    return '';
  }

  /**
   * 将 content（Quill HTML）中的 <video> 块注入到 contentMd（Markdown）的正确位置。
   * 通过识别 HTML 中每个视频前面的标题，在 Markdown 对应标题行后插入视频 HTML 块。
   * 这样前端用 contentMd 渲染时既有代码高亮（Prism），又能在正确位置显示视频。
   */
  private injectVideosIntoMarkdown(
    contentMd: string,
    contentHtml: string,
  ): string {
    const videoRegex =
      /<figure[^>]*>[\s\S]*?<video[\s\S]*?<\/video>[\s\S]*?<\/figure>|<video[\s\S]*?<\/video>/gi;

    // 首先从 contentMd 中移除所有已存在的视频标签（通常在末尾，由翻译processor追加）
    // 避免重复注入导致视频出现多次
    let cleanedMd = contentMd
      .replace(videoRegex, '')  // 移除视频标签
      .replace(/\n{3,}/g, '\n\n')  // 清理多余空行（3个以上连续换行 → 2个）
      .trim();

    // 收集所有视频块及其在 HTML 中的位置
    const videos: Array<{ index: number; block: string }> = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(videoRegex.source, 'gi');
    while ((m = re.exec(contentHtml)) !== null) {
      videos.push({ index: m.index, block: m[0] });
    }
    if (videos.length === 0) return cleanedMd;

    const mdLines = cleanedMd.split('\n');

    // 每个视频的插入操作 { lineIndex: 插入到该行之后, block: 视频块, position: 视频在HTML中的位置百分比 }
    const insertions: Array<{ lineIndex: number; block: string; position: number }> = [];

    for (const { index: videoIdx, block } of videos) {
      const htmlBefore = contentHtml.substring(0, videoIdx);
      const positionPercent = (videoIdx / contentHtml.length) * 100;

      // 找到视频前最近的 HTML 标题
      const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
      let lastHeading: { level: number; text: string } | null = null;
      let hm: RegExpExecArray | null;
      const hr = new RegExp(headingRegex.source, 'gi');
      while ((hm = hr.exec(htmlBefore)) !== null) {
        const level = parseInt(hm[1]);
        // 去掉内部标签（如 <br>、<strong> 等），得到纯文本
        const text = hm[2]
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) lastHeading = { level, text };
      }

      let insertLineIndex = -1; // -1 表示特殊处理

      if (lastHeading) {
        const { level, text } = lastHeading;
        const mdPrefix = '#'.repeat(level) + ' ';

        // 在 Markdown 行中找到匹配的标题（从前往后查找第一个匹配）
        for (let i = 0; i < mdLines.length; i++) {
          const line = mdLines[i].trim();
          if (line.startsWith(mdPrefix)) {
            const mdText = line.slice(mdPrefix.length).trim();
            if (this.textSimilar(mdText, text)) {
              insertLineIndex = i;
              this.logger.debug(
                `[视频注入] 找到匹配标题: "${text}" -> Markdown 行 ${i}: "${line}"`,
              );
              break;
            }
          }
        }

        if (insertLineIndex === -1) {
          this.logger.warn(
            `[视频注入] 未找到匹配标题 "${text}" (H${level})，视频位于 HTML ${positionPercent.toFixed(1)}% 处`,
          );
        }
      } else {
        this.logger.debug(
          `[视频注入] 视频前没有标题，位于 HTML ${positionPercent.toFixed(1)}% 处`,
        );
      }

      insertions.push({ lineIndex: insertLineIndex, block, position: positionPercent });
    }

    // 从下往上插入，避免行号偏移
    insertions.sort((a, b) => b.lineIndex - a.lineIndex);

    for (const { lineIndex, block, position } of insertions) {
      if (lineIndex >= 0) {
        // 找到匹配标题：将视频块插入到对应标题行之后
        mdLines.splice(lineIndex + 1, 0, '', block, '');
        this.logger.debug(`[视频注入] 插入到标题后 (行 ${lineIndex + 1})`);
      } else {
        // 没有找到匹配的标题：根据视频在 HTML 中的位置决定插入位置
        if (position < 20) {
          // 视频在 HTML 前 20% → 插入到 Markdown 开头
          mdLines.unshift(block, '');
          this.logger.debug(`[视频注入] 插入到文档开头 (HTML位置: ${position.toFixed(1)}%)`);
        } else {
          // 视频在 HTML 后 80% → 插入到 Markdown 末尾
          mdLines.push('', block);
          this.logger.debug(`[视频注入] 插入到文档末尾 (HTML位置: ${position.toFixed(1)}%)`);
        }
      }
    }

    return mdLines.join('\n');
  }

  /**
   * 文本相似度比较：去掉非字母数字和非中文字符后全小写对比
   */
  private textSimilar(a: string, b: string): boolean {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]/g, '');
    const na = normalize(a);
    const nb = normalize(b);

    // 完全匹配
    if (na === nb) return true;

    // 一个包含另一个（移除长度限制，支持短标题）
    if (na.length > 0 && nb.length > 0) {
      if (na.includes(nb) || nb.includes(na)) return true;
    }

    return false;
  }
}
