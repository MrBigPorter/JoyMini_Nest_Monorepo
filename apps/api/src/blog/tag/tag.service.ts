import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';

@Injectable()
export class TagService {
  private readonly logger = new Logger(TagService.name);

  constructor(
    private prisma: PrismaService,
    private systemConfigService: SystemConfigService,
  ) {}

  /**
   * 创建标签
   */
  async createTag(data: {
    name: Record<string, string | undefined>;
    slug?: string;
    color?: string;
    description?: Record<string, string | undefined>;
  }) {
    this.logger.log(`Creating tag with data: ${JSON.stringify(data)}`);

    // Validate input
    if (!data.name || typeof data.name !== 'object') {
      this.logger.warn('Tag creation failed: Tag name is required');
      throw new Error('Tag name is required');
    }

    // Check name length for each locale
    for (const [locale, value] of Object.entries(data.name)) {
      if (value && value.length > 100) {
        this.logger.warn(
          `Tag creation failed: Tag name too long for locale ${locale} (${value.length} chars)`,
        );
        throw new Error('Tag name must be 100 characters or less');
      }
    }

    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      this.logger.warn(
        `Tag creation failed: Invalid color format: ${data.color}`,
      );
      throw new Error('Invalid color format. Use hex format like #3b82f6');
    }

    if (data.description && typeof data.description === 'object') {
      for (const [locale, value] of Object.entries(data.description)) {
        if (value && value.length > 300) {
          this.logger.warn(
            `Tag creation failed: Description too long for locale ${locale} (${value.length} chars)`,
          );
          throw new Error('Tag description must be 300 characters or less');
        }
      }
    }

    // Generate slug if not provided
    let slug = data.slug;
    if (!slug) {
      // 从中文语言版本生成 slug
      const nameForSlug =
        typeof data.name === 'object'
          ? data.name.zh || Object.values(data.name).find((v) => v) || ''
          : data.name;

      slug = nameForSlug
        .toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

      this.logger.log(`Generated slug from name: ${slug}`);
    }

    // Ensure slug is not empty after processing
    if (!slug) {
      this.logger.error('Unable to generate slug from tag name');
      throw new Error('Unable to generate slug from tag name');
    }

    // Check for duplicate slug and append number if needed
    let finalSlug = slug;
    let counter = 1;
    while (true) {
      const existingTag = await this.prisma.blogTag.findUnique({
        where: { slug: finalSlug },
      });

      if (!existingTag) {
        break;
      }

      this.logger.log(
        `Slug ${finalSlug} already exists, trying ${slug}-${counter}`,
      );
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    try {
      const tag = await this.prisma.blogTag.create({
        data: {
          name: data.name,
          slug: finalSlug,
          color: data.color || undefined,
          description: data.description,
        },
      } as any);

      this.logger.log(`Tag created successfully: ${tag.id} - ${finalSlug}`);
      return tag;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to create tag: ${errorMessage}`, stack);
      throw error;
    }
  }

  /**
   * 获取标签列表
   */
  async getTags(includeCount = true, sortBy = 'articles', search?: string) {
    const orderBy: any =
      sortBy === 'articles'
        ? { articles: { _count: 'desc' as const } }
        : { createdAt: 'desc' as const };

    const where: any = {};
    if (search && search.trim()) {
      const searchTerm = search.trim();
      // 动态搜索所有已启用的语言
      const localeResult = await this.systemConfigService.getEnabledLocales();
      const enabledLocales = localeResult.list
        .filter((l) => l.enabled)
        .map((l) => l.code);

      where.OR = enabledLocales
        .map((lang: string) => [
          { name: { path: [lang], string_contains: searchTerm } },
          { description: { path: [lang], string_contains: searchTerm } },
        ])
        .flat();
    }

    const tags = await this.prisma.blogTag.findMany({
      where,
      orderBy,
      include: includeCount
        ? {
            articles: {
              where: { status: 'PUBLISHED' },
              select: { id: true }
            }
          }
        : undefined,
    });

    if (includeCount) {
      return tags.map((tag: any) => {
        const { articles, ...rest } = tag;
        return {
          ...rest,
          _count: {
            articles: articles.length
          }
        };
      });
    }

    return tags;
  }

  /**
   * 获取热门标签
   */
  async getPopularTags(limit = 20) {
    const tags = await this.prisma.blogTag.findMany({
      take: limit,
      orderBy: {
        articles: { _count: 'desc' },
      },
      include: {
        articles: {
          where: { status: 'PUBLISHED' },
          select: { id: true }
        }
      },
    });

    return tags.map((tag: any) => {
      const { articles, ...rest } = tag;
      return {
        ...rest,
        _count: {
          articles: articles.length
        }
      };
    });
  }

  /**
   * 获取标签详情
   */
  async getTag(id: string) {
    const tag = await this.prisma.blogTag.findUnique({
      where: { id },
      include: {
        articles: {
          where: { status: 'PUBLISHED' },
          select: { id: true }
        }
      },
    });

    if (!tag) {
      throw new NotFoundException('标签不存在');
    }

    const { articles, ...rest } = tag;
    return {
      ...rest,
      _count: {
        articles: articles.length
      }
    };
  }

  /**
   * 更新标签
   */
  async updateTag(
    id: string,
    data: {
      name?: Record<string, string | undefined>;
      slug?: string;
      color?: string;
      description?: Record<string, string | undefined>;
    },
  ) {
    this.logger.log(`Updating tag ${id} with data: ${JSON.stringify(data)}`);

    try {
      const tag = await this.prisma.blogTag.update({
        where: { id },
        data,
      });

      this.logger.log(`Tag ${id} updated successfully`);
      return tag;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to update tag ${id}: ${errorMessage}`, stack);
      throw error;
    }
  }

  /**
   * 删除标签
   */
  async deleteTag(id: string) {
    this.logger.log(`Deleting tag: ${id}`);

    try {
      // 自动解除所有文章关联
      const articles = await this.prisma.blogArticle.findMany({
        where: { tags: { some: { id } } },
        select: { id: true },
      });

      this.logger.log(`Found ${articles.length} articles associated with tag ${id}`);

      // 对每个文章执行单独的更新操作以解除标签关联
      for (const article of articles) {
        await this.prisma.blogArticle.update({
          where: { id: article.id },
          data: {
            tags: {
              disconnect: { id },
            },
          },
        });
      }

      if (articles.length > 0) {
        this.logger.log(`Disconnected tag ${id} from ${articles.length} articles`);
      }

      const deletedTag = await this.prisma.blogTag.delete({
        where: { id },
      });

      this.logger.log(`Tag deleted successfully: ${id}`);
      return deletedTag;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to delete tag ${id}: ${errorMessage}`, stack);
      throw error;
    }
  }
}