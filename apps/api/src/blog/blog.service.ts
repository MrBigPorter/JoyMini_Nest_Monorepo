import * as fs from 'fs';
import * as path from 'path';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { ArticleStatus, Prisma } from '@prisma/client';
import { CreateArticleDto, UpdateArticleDto, CreateCommentDto } from './dto';
import {
  ScannedArticle,
  BatchImportDto,
  BatchImportResult,
  BatchImportResultItem,
} from './dto/batch-import.dto';
import { plainToInstance } from 'class-transformer';
import {
  CommentListResponseDto,
  CommentResponseDto,
} from './dto/comment-response.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MEDIA_PROCESSOR_QUEUE } from '@api/common/media/media-processor.constants';
import { Marked } from 'marked';
import type { LocalizedString } from '@lucky/shared';
import { getLocalizedValue, DEFAULT_LOCALE } from '@lucky/shared';
import { SystemConfigService } from '../admin/system-config/system-config.service';
import { LanguageService } from '@api/common/services/language.service';
import { AiService, AiServiceLevel } from '@api/common/ai/ai.service';

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);
  private readonly marked: Marked;

  constructor(
    private prisma: PrismaService,
    @InjectQueue('blog-ai') private blogAiQueue: Queue,
    @InjectQueue(MEDIA_PROCESSOR_QUEUE) private mediaProcessorQueue: Queue,
    private systemConfigService: SystemConfigService,
    private languageService: LanguageService,
    private aiService: AiService,
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
      // 同步设置普通字段（Prisma 必需），取 zh 或第一个可用值
      data[legacyFieldName] =
        (field as any).zh || Object.values(field as any)[0] || '';
    }
    // 旧单值格式转换
    else {
      data[`${legacyFieldName}Localized`] = {
        zh: field,
      };
      data[legacyFieldName] = field;
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
        featured: dto.featured ?? false,
        meta: dto.meta ?? undefined,
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

  // ── 批量扫描 & 导入 ──────────────────────────────────────────────

  /**
   * 扫描本地 docs/blog/articles/ 中的 Markdown 文件，返回文章元数据列表
   * 同时检查每个文件推导出的 slug 是否已存在于数据库中
   */
  async scanLocalMarkdownFiles(): Promise<ScannedArticle[]> {
    // 在 Docker 容器内，工作目录是 /app，所以 docs 在 /app/docs
    const articlesDir = path.resolve(process.cwd(), 'docs/blog/articles');

    if (!fs.existsSync(articlesDir)) {
      this.logger.warn(`扫描本地文章: 目录不存在 ${articlesDir}`);
      return [];
    }

    const mdFiles: string[] = [];
    this.walkDirectory(articlesDir, mdFiles);

    // 收集所有已存在 slug，批量查询一次
    const allSlugs = new Set<string>();
    const parsedFiles: {
      filepath: string;
      parsed: {
        filename: string;
        title: string;
        excerpt: string;
        content: string;
        tags: string[];
      };
    }[] = [];

    for (const filepath of mdFiles) {
      try {
        const parsed = this.parseMarkdownFile(filepath);
        const slug = this.filenameToSlug(parsed.filename);
        allSlugs.add(slug);
        parsedFiles.push({ filepath, parsed });
      } catch (err) {
        this.logger.warn(
          `扫描文件跳过: ${filepath} - ${(err as Error).message}`,
        );
      }
    }

    // 批量查询已存在的 slug
    const existingSlugs = new Set<string>();
    if (allSlugs.size > 0) {
      const existing = await this.prisma.blogArticle.findMany({
        where: { slug: { in: Array.from(allSlugs) } },
        select: { slug: true },
      });
      existing.forEach((a) => existingSlugs.add(a.slug));
    }

    const results: ScannedArticle[] = [];
    for (const { filepath, parsed } of parsedFiles) {
      const slug = this.filenameToSlug(parsed.filename);
      const stat = fs.statSync(filepath);
      const relDir = this.getSubdirectory(filepath, articlesDir);

      results.push({
        filename: parsed.filename,
        slug,
        title: parsed.title,
        excerpt: parsed.excerpt,
        content: parsed.content,
        tags: parsed.tags,
        subdir: relDir,
        exists: existingSlugs.has(slug),
        fileSize: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    }

    return results;
  }

  /**
   * 批量导入文章
   */
  async batchImportArticles(
    authorId: string,
    dto: BatchImportDto,
  ): Promise<BatchImportResult> {
    const defaultStatus = dto.defaultStatus || ArticleStatus.DRAFT;
    const overwrite = dto.overwrite ?? false;
    const results: BatchImportResultItem[] = [];

    for (const item of dto.articles) {
      try {
        // 检查 slug 是否已存在
        const existing = await this.prisma.blogArticle.findUnique({
          where: { slug: item.slug },
          select: { id: true },
        });

        if (existing) {
          if (overwrite) {
            // 更新已有文章
            const updated = await this.prisma.blogArticle.update({
              where: { id: existing.id },
              data: {
                status: item.status || defaultStatus,
                authorId,
                ...this.buildLocalizedData({ zh: item.title }, 'title'),
                ...this.buildLocalizedData(
                  { zh: this.renderMarkdown(item.content) },
                  'content',
                ),
                ...this.buildLocalizedData({ zh: item.content }, 'contentMd'),
                ...this.buildLocalizedData(
                  item.excerpt ? { zh: item.excerpt } : undefined,
                  'excerpt',
                ),
              },
            });
            results.push({
              filename: item.filename,
              articleId: updated.id,
              slug: item.slug,
              success: true,
            });
          } else {
            // 跳过
            results.push({
              filename: item.filename,
              slug: item.slug,
              success: false,
              error: 'Slug 已存在',
            });
          }
          continue;
        }

        // 处理标签：按名称查找或创建
        const tagIds: string[] = [];
        if (item.tags && item.tags.length > 0) {
          for (const tagName of item.tags) {
            const tagId = await this.findOrCreateTag(tagName);
            tagIds.push(tagId);
          }
        }

        // 创建新文章
        const article = await this.prisma.blogArticle.create({
          data: {
            slug: item.slug,
            status: item.status || defaultStatus,
            authorId,
            categoryId: item.categoryId || null,
            tags:
              tagIds.length > 0
                ? { connect: tagIds.map((id) => ({ id })) }
                : undefined,
            ...this.buildLocalizedData({ zh: item.title }, 'title'),
            ...this.buildLocalizedData(
              { zh: this.renderMarkdown(item.content) },
              'content',
            ),
            ...this.buildLocalizedData({ zh: item.content }, 'contentMd'),
            ...this.buildLocalizedData(
              item.excerpt ? { zh: item.excerpt } : undefined,
              'excerpt',
            ),
          },
        });

        results.push({
          filename: item.filename,
          articleId: article.id,
          slug: article.slug,
          success: true,
        });
      } catch (err) {
        results.push({
          filename: item.filename,
          slug: item.slug,
          success: false,
          error: (err as Error).message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter(
      (r) => !r.success && !r.error?.includes('已存在'),
    ).length;
    const skippedCount = results.filter(
      (r) => !r.success && r.error?.includes('已存在'),
    ).length;

    return {
      successCount,
      failureCount,
      skippedCount,
      results,
    };
  }

  // ── 扫描 & 导入辅助方法 ──────────────────────────────────────────

  /**
   * 递归遍历目录收集 .md 文件
   */
  private walkDirectory(dir: string, results: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDirectory(fullPath, results);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  /**
   * 解析 Markdown 文件，提取标题、摘要和正文
   */
  private parseMarkdownFile(filepath: string): {
    filename: string;
    title: string;
    excerpt: string;
    content: string;
    tags: string[];
  } {
    const raw = fs.readFileSync(filepath, 'utf-8');
    const lines = raw.split('\n');

    // 1. 提取标题
    let title = '';
    let titleLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('# ')) {
        title = trimmed.replace(/^#\s+/, '').trim();
        titleLineIndex = i;
        break;
      }
    }

    if (!title) {
      throw new Error(`无法找到 # 标题`);
    }

    // 2. 提取摘要
    let excerpt = '';
    let excerptLineIndex = -1;
    for (let i = titleLineIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('> ')) {
        excerpt = trimmed.replace(/^>\s+/, '').trim();
        excerptLineIndex = i;
        break;
      }
      if (trimmed === '---' || (trimmed !== '' && !trimmed.startsWith('>'))) {
        break;
      }
    }

    // 3. 提取正文 - start from after title (or after excerpt if found)
    const contentStartIndex =
      excerptLineIndex !== -1 ? excerptLineIndex + 1 : titleLineIndex + 1;

    const bodyLines = lines.slice(contentStartIndex);

    // 4. 提取 Tags
    const tags: string[] = [];
    const firstBodyLine = bodyLines[0]?.trim() || '';
    const tagsMatch = firstBodyLine.match(/^Tags:\s*(.+)$/i);
    if (tagsMatch) {
      tags.push(
        ...tagsMatch[1]
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      );
      bodyLines.shift();
    }

    const content = bodyLines.join('\n').trim();

    if (!content) {
      throw new Error('正文内容为空');
    }

    return {
      filename: path.basename(filepath),
      title,
      excerpt,
      tags,
      content,
    };
  }

  /**
   * 文件名转 Slug
   * example-file.md → example-file
   */
  private filenameToSlug(filename: string): string {
    return filename.replace(/\.md$/i, '');
  }

  /**
   * 获取文件相对于 articles/ 的子目录名
   */
  private getSubdirectory(
    filepath: string,
    articlesDir: string,
  ): string | null {
    const rel = path.relative(articlesDir, filepath);
    const dir = path.dirname(rel);
    if (dir === '.') return null;
    return dir.split(path.sep)[0];
  }

  /**
   * 按标签名称查找或创建标签，返回标签 ID
   */
  private async findOrCreateTag(tagName: string): Promise<string> {
    // 生成标准化 slug：去除特殊字符、转小写、连字符
    const normalizeSlug = (name: string): string =>
      name
        .toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    const searchSlug = normalizeSlug(tagName);

    // 查找名称匹配的标签（中文、英文或标准化 slug）
    const existing = await this.prisma.blogTag.findFirst({
      where: {
        OR: [
          { name: { path: ['zh'], equals: tagName } },
          { name: { path: ['en'], equals: tagName } },
          { slug: searchSlug },
        ],
      },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    // 创建新标签
    const slug = searchSlug || tagName.toLowerCase().replace(/\s+/g, '-');

    const tag = await this.prisma.blogTag.create({
      data: {
        name: { zh: tagName },
        slug,
      },
    });

    return tag.id;
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
        ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
        ...(dto.meta !== undefined ? { meta: dto.meta } : {}),
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
          featured: true,
          translationStatus: true,
          translatedAt: true,
          meta: true,
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
        if (
          locale &&
          fixedValue[locale] &&
          typeof fixedValue[locale] === 'string'
        ) {
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
        if (
          locale &&
          fixedValue[locale] &&
          typeof fixedValue[locale] === 'string'
        ) {
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

    // Check AI service budget before enqueuing
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      throw new BadRequestException(
        'AI translation service is currently disabled due to daily budget limit. Please try again tomorrow.',
      );
    }

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
    // Check AI service budget before enqueuing
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      throw new BadRequestException(
        'AI translation service is currently disabled due to daily budget limit. Please try again tomorrow.',
      );
    }

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
    // Check AI service budget before enqueuing
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      throw new BadRequestException(
        'AI translation service is currently disabled due to daily budget limit. Please try again tomorrow.',
      );
    }

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
    const tags = await this.prisma.blogTag.findMany({
      orderBy: {
        articles: { _count: 'desc' },
      },
      take: limit,
      include: {
        articles: {
          where: { status: 'PUBLISHED' },
          select: { id: true },
        },
      },
    });

    return tags.map((tag: any) => {
      const { articles, ...rest } = tag;
      return {
        ...rest,
        _count: {
          articles: articles.length,
        },
      };
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
   * 监听 blog 语言启用事件，自动触发全库翻译
   */
  @OnEvent('locale.blog.enabled')
  async handleLocaleEnabled(targetLang: string) {
    this.logger.log(`🔔 Received locale enabled event: ${targetLang}`);
    return this.queueFullLocaleTranslation(targetLang);
  }

  /**
   * 为特定语言批量投递全库翻译任务
   */
  async queueFullLocaleTranslation(targetLang: string) {
    // Check AI service budget before enqueuing batch translations
    if (this.aiService.getServiceLevel() === AiServiceLevel.DISABLED) {
      throw new BadRequestException(
        'AI translation service is currently disabled due to daily budget limit. Please try again tomorrow.',
      );
    }

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
  checkLikeStatus(slug: string, fingerprint: string) {
    // 后续实现指纹检查逻辑
    return { liked: false };
  }

  /**
   * 创建评论
   */

  async createComment(
    slug: string,
    dto: CreateCommentDto,
    userId?: string | null,
  ) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('Article not found');

    // For anonymous comments, validate that author is provided
    if (!dto.author) {
      throw new BadRequestException(
        'Author name is required for anonymous comments',
      );
    }

    const commentData: Prisma.BlogCommentCreateInput = {
      article: { connect: { id: article.id } },
      author: dto.author,
      email: dto.email || '',
      website: dto.website,
      content: dto.content,
      status: 'PENDING',
    };

    // Handle parent comment relation if parentId is provided
    if (dto.parentId) {
      commentData.parent = { connect: { id: dto.parentId } };
    }

    const comment = await this.prisma.blogComment.create({
      data: commentData,
    });

    // Update article comment count
    await this.prisma.blogArticle.update({
      where: { id: article.id },
      data: { commentCount: { increment: 1 } },
    });

    // Add to AI moderation queue
    await this.blogAiQueue.add(
      'moderate-comment',
      {
        commentId: comment.id,
        content: comment.content,
        articleTitle: article.title,
      },
      { delay: 1000 }, // Delay 1 second for immediate response
    );

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
      include: {
        articles: {
          where: { status: 'PUBLISHED' },
          select: { id: true },
        },
      },
    });

    // 应用Localized格式转换，并注入文章计数
    return categories.map((category: any) => {
      const { articles, ...rest } = category;
      return this.mapCategoryToLocalized({
        ...rest,
        _count: { articles: articles.length },
      });
    });
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
      include: {
        articles: {
          where: { status: 'PUBLISHED' },
          select: { id: true },
        },
      },
    });

    // 应用Localized格式转换，并注入文章计数
    return tags.map((tag: any) => {
      const { articles, ...rest } = tag;
      return this.mapTagToLocalized({
        ...rest,
        _count: { articles: articles.length },
      });
    });
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
   * 获取文章评论（已脱敏）
   */
  async getArticleComments(slug: string, params: any) {
    const article = await this.prisma.blogArticle.findUnique({
      where: { slug },
    });
    if (!article) throw new NotFoundException('Article not found');

    const { page = 1, pageSize = 20 } = params;

    const skip = (page - 1) * pageSize;

    // 获取所有已审核评论（包括回复）
    const [allComments, total] = await Promise.all([
      this.prisma.blogComment.findMany({
        where: {
          articleId: article.id,
          status: 'APPROVED',
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.blogComment.count({
        where: {
          articleId: article.id,
          status: 'APPROVED',
        },
      }),
    ]);

    // 构建树形结构
    const commentTree = this.buildCommentTree(allComments);

    // 分页处理：只对根评论进行分页
    const paginatedRootComments = commentTree.slice(skip, skip + pageSize);

    // 应用脱敏转换
    const maskedComments = this.applyCommentMasking(paginatedRootComments);

    return {
      items: maskedComments,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 应用评论脱敏
   */
  private applyCommentMasking(comments: any[]): CommentResponseDto[] {
    if (!comments || comments.length === 0) {
      return [];
    }

    const maskedComments = comments.map((comment) => {
      // 确保status字段存在，以便@Transform能正确转换approved字段
      const commentWithStatus = {
        ...comment,
        status: comment.status || 'PENDING', // 确保status字段存在
      };

      // 转换单个评论
      const maskedComment = plainToInstance(
        CommentResponseDto,
        commentWithStatus,
        {
          excludeExtraneousValues: true,
          enableImplicitConversion: true,
        },
      );

      // 递归处理子评论
      if (comment.children && comment.children.length > 0) {
        maskedComment.children = this.applyCommentMasking(comment.children);
      }

      return maskedComment;
    });

    return maskedComments;
  }

  /**
   * 构建评论树形结构（与 CommentService 中的逻辑相同）
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
   * 查询单个评论状态
   * 用于前端轮询评论审核状态
   */
  async getCommentStatus(commentId: string): Promise<{
    id: string;
    status: string;
    articleId: string;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const comment = await this.prisma.blogComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        status: true,
        articleId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!comment) {
      throw new NotFoundException(`评论 ${commentId} 不存在`);
    }

    return {
      id: comment.id,
      status: comment.status,
      articleId: comment.articleId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }

  /**
   * 查询评论的回复列表
   * 用于前端检查是否有自动回复
   */
  async getCommentReplies(commentId: string): Promise<{
    commentId: string;
    replies: Array<{
      id: string;
      author: string;
      email: string;
      content: string;
      isAiGenerated: boolean;
      createdAt: Date;
    }>;
  }> {
    // 首先检查评论是否存在
    const comment = await this.prisma.blogComment.findUnique({
      where: { id: commentId },
      select: { id: true, articleId: true },
    });

    if (!comment) {
      throw new NotFoundException(`评论 ${commentId} 不存在`);
    }

    // 查询该评论的所有回复（parentId = commentId）
    const replies = await this.prisma.blogComment.findMany({
      where: {
        parentId: commentId,
        status: 'APPROVED', // 只返回已审核通过的回复
      },
      select: {
        id: true,
        author: true,
        email: true,
        content: true,
        isAiGenerated: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' }, // 按创建时间排序
    });

    // 判断是否为自动回复（作者为"Porter"或"System"，或isAiGenerated为true）
    const processedReplies = replies.map((reply) => ({
      ...reply,
      isAiGenerated:
        reply.isAiGenerated ||
        reply.author === 'Porter' ||
        reply.author === 'System' ||
        reply.email === 'porter@joyminis.com' ||
        reply.email === 'system@joyminis.com',
    }));

    return {
      commentId,
      replies: processedReplies,
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
   * ✅ 统一翻译完成检测逻辑
   * 检测文章是否已经完成指定语言的翻译
   * 同时检查标题和内容都有实际翻译内容，而不是只看标记状态
   */
  private isArticleTranslated(article: any, targetLang: string): boolean {
    // 检查 Localized 字段
    if (
      article.titleLocalized &&
      typeof article.titleLocalized === 'object' &&
      article.titleLocalized[targetLang] &&
      article.titleLocalized[targetLang].trim().length > 0
    ) {
      // 同时检查内容也有翻译
      if (
        article.contentLocalized &&
        typeof article.contentLocalized === 'object' &&
        article.contentLocalized[targetLang] &&
        article.contentLocalized[targetLang].trim().length > 0
      ) {
        return true;
      }
    }

    // 兼容旧字段格式
    const langSuffix =
      targetLang === 'zh'
        ? ''
        : targetLang.charAt(0).toUpperCase() + targetLang.slice(1);
    if (
      article[`title${langSuffix}`] &&
      article[`title${langSuffix}`].trim().length > 0 &&
      article[`content${langSuffix}`] &&
      article[`content${langSuffix}`].trim().length > 0
    ) {
      return true;
    }

    return false;
  }

  /**
   * 获取翻译进度统计
   */
  async getTranslationProgress(languageCode?: string) {
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

    // ✅ 修复: 只要实际有翻译内容就算完成，不管translationStatus标记
    // 很多旧文章有翻译内容但没设置COMPLETED状态
    const completedResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM blog_articles 
      WHERE status != 'DRAFT' 
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

    // ✅ 修复: 只有明确标记为TRANSLATING的才算进行中
    const inProgress = await this.prisma.blogArticle.count({
      where: {
        status: { not: 'DRAFT' },
        translationStatus: 'TRANSLATING',
      },
    });

    // ✅ 正确的计算公式
    // pending = total - completed - failed - inProgress
    const pending = Math.max(0, total - completed - failed - inProgress);

    return {
      total,
      completed,
      failed,
      pending,
      inProgress,
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
  getTranslationLogs(params: { page: number; pageSize: number }) {
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
      const targetLang = languageCode || 'en';

      // 获取所有文章
      const articles = await this.prisma.blogArticle.findMany({
        select: {
          id: true,
          title: true,
          titleLocalized: true,
          contentLocalized: true,
          excerptLocalized: true,
          translationStatus: true,
          titleEn: true,
          contentEn: true,
        },
      });

      // 检测缺失翻译的分类
      const untranslatedCategories = await this.prisma.$queryRaw<
        { id: string; name: Record<string, string>; slug: string }[]
      >`
        SELECT id, name, slug FROM blog_categories
        WHERE
          "name" IS NULL
          OR "name" = 'null'::jsonb
          OR "name"->${targetLang} IS NULL
          OR jsonb_typeof("name"->${targetLang}) = 'null'
          OR "name"->>${targetLang} = ''
      `;

      // 检测缺失翻译的标签
      const untranslatedTags = await this.prisma.$queryRaw<
        { id: string; name: Record<string, string>; slug: string }[]
      >`
        SELECT id, name, slug FROM blog_tags
        WHERE
          "name" IS NULL
          OR "name" = 'null'::jsonb
          OR "name"->${targetLang} IS NULL
          OR jsonb_typeof("name"->${targetLang}) = 'null'
          OR "name"->>${targetLang} = ''
      `;

      const articleIssues = [];
      for (const article of articles) {
        // ✅ 修复: 如果文章已经完整翻译，直接跳过不加入问题列表
        if (this.isArticleTranslated(article, targetLang)) {
          continue;
        }

        const issues = this.detectArticleTranslationIssues(
          article,
          languageCode,
        );
        if (issues.length > 0) {
          articleIssues.push({
            articleId: article.id,
            articleTitle: article.title,
            issues,
          });
        }
      }

      this.logger.log(
        `检测完成: ${articleIssues.length} 篇文章, ${untranslatedCategories.length} 个分类, ${untranslatedTags.length} 个标签有翻译问题`,
      );
      return {
        success: true,
        totalArticles: articles.length,
        problematicArticles: articleIssues.length,
        issues: articleIssues,
        categories: untranslatedCategories.map((c) => ({
          categoryId: c.id,
          categoryName: c.name,
          slug: c.slug,
          issues: [
            {
              issueType: 'NOT_TRANSLATED',
              severity: 'MEDIUM',
              description: `Category "${c.name?.zh || c.slug}" is missing ${targetLang} translation`,
            },
          ],
        })),
        tags: untranslatedTags.map((t) => ({
          tagId: t.id,
          tagName: t.name,
          slug: t.slug,
          issues: [
            {
              issueType: 'NOT_TRANSLATED',
              severity: 'MEDIUM',
              description: `Tag "${t.name?.zh || t.slug}" is missing ${targetLang} translation`,
            },
          ],
        })),
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
   * 获取翻译任务详情（持久化记录）
   */
  async getTranslationJobsDetail(
    targetLang?: string,
    status?: string[],
    page?: number,
    pageSize?: number,
  ) {
    const { page: currentPage = 1, pageSize: itemsPerPage = 20 } = {
      page,
      pageSize,
    };
    const skip = (currentPage - 1) * itemsPerPage;

    const where: any = {};

    if (targetLang) {
      where.targetLang = targetLang;
    }

    if (status && status.length > 0) {
      where.status = { in: status };
    }

    const [items, total] = await Promise.all([
      this.prisma.translationJob.findMany({
        where,
        skip,
        take: itemsPerPage,
        orderBy: { createdAt: 'desc' },
        include: {
          article: { select: { id: true, title: true, slug: true } },
        },
      }),
      this.prisma.translationJob.count({ where }),
    ]);

    return {
      items,
      total,
      page: currentPage,
      pageSize: itemsPerPage,
      totalPages: Math.ceil(total / itemsPerPage),
    };
  }

  /**
   * 获取指定语言下未翻译的文章列表
   */
  async getUntranslatedArticles(languageCode: string) {
    if (!languageCode) {
      throw new BadRequestException('languageCode parameter is required');
    }

    const articles = await this.prisma.$queryRaw<
      { id: string; title: string; slug: string; createdAt: Date }[]
    >`
      SELECT id, title, slug, created_at as "createdAt" FROM blog_articles
      WHERE status != 'DRAFT'
        AND (
          "titleLocalized" IS NULL
          OR "titleLocalized" = 'null'::jsonb
          OR "titleLocalized"->${languageCode} IS NULL
          OR jsonb_typeof("titleLocalized"->${languageCode}) = 'null'
          OR "titleLocalized"->>${languageCode} = ''
        )
      ORDER BY created_at DESC
    `;

    return {
      languageCode,
      count: articles.length,
      articles,
    };
  }

  /**
   * 获取指定语言下未翻译的分类列表
   */
  async getUntranslatedCategories(languageCode: string) {
    if (!languageCode) {
      throw new BadRequestException('languageCode parameter is required');
    }

    const categories = await this.prisma.$queryRaw<
      {
        id: string;
        name: Record<string, string>;
        slug: string;
        createdAt: Date;
      }[]
    >`
      SELECT id, name, slug, created_at as "createdAt" FROM blog_categories
      WHERE
        "name" IS NULL
        OR "name" = 'null'::jsonb
        OR "name"->${languageCode} IS NULL
        OR jsonb_typeof("name"->${languageCode}) = 'null'
        OR "name"->>${languageCode} = ''
      ORDER BY created_at DESC
    `;

    return {
      languageCode,
      count: categories.length,
      categories,
    };
  }

  /**
   * 获取指定语言下未翻译的标签列表
   */
  async getUntranslatedTags(languageCode: string) {
    if (!languageCode) {
      throw new BadRequestException('languageCode parameter is required');
    }

    const tags = await this.prisma.$queryRaw<
      {
        id: string;
        name: Record<string, string>;
        slug: string;
        color: string | null;
        createdAt: Date;
      }[]
    >`
      SELECT id, name, slug, color, created_at as "createdAt" FROM blog_tags
      WHERE
        "name" IS NULL
        OR "name" = 'null'::jsonb
        OR "name"->${languageCode} IS NULL
        OR jsonb_typeof("name"->${languageCode}) = 'null'
        OR "name"->>${languageCode} = ''
      ORDER BY created_at DESC
    `;

    return {
      languageCode,
      count: tags.length,
      tags,
    };
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

  /**
   * Trigger video transcoding for an article by video key
   */
  async triggerVideoTranscode(articleId: string, videoKey: string) {
    // Set video status to 'pending'
    const article = await this.prisma.blogArticle.findUnique({
      where: { id: articleId },
      select: { meta: true },
    });
    if (!article) {
      throw new NotFoundException(`Article ${articleId} not found`);
    }

    const existingMeta = (article?.meta as Record<string, any>) || {};
    await this.prisma.blogArticle.update({
      where: { id: articleId },
      data: {
        meta: {
          ...existingMeta,
          video: { status: 'pending' },
        } as any,
      },
    });

    // Enqueue transcoding job — the processor will download from R2
    await this.mediaProcessorQueue.add('transcode-video', {
      articleId,
      videoKey,
      mimeType: 'video/mp4',
    });

    this.logger.log(
      `Video transcoding triggered for article ${articleId}: ${videoKey}`,
    );
  }
}
