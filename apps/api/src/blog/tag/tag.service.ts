import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class TagService {
  private readonly logger = new Logger(TagService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建标签
   */

  async createTag(data: {
    name: string;
    slug?: string;
    color?: string;
    description?: string;
  }) {
    this.logger.log(`Creating tag with data: ${JSON.stringify(data)}`);

    // Validate input
    if (!data.name || data.name.trim().length === 0) {
      this.logger.warn('Tag creation failed: Tag name is required');
      throw new Error('Tag name is required');
    }

    if (data.name.trim().length > 100) {
      this.logger.warn(
        `Tag creation failed: Tag name too long (${data.name.trim().length} chars)`,
      );
      throw new Error('Tag name must be 100 characters or less');
    }

    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      this.logger.warn(
        `Tag creation failed: Invalid color format: ${data.color}`,
      );
      throw new Error('Invalid color format. Use hex format like #3b82f6');
    }

    if (data.description && data.description.length > 300) {
      this.logger.warn(
        `Tag creation failed: Description too long (${data.description.length} chars)`,
      );
      throw new Error('Tag description must be 300 characters or less');
    }

    // Generate slug if not provided
    let slug = data.slug;
    if (!slug) {
      // Convert to kebab-case and remove special characters
      slug = data.name
        .toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

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
          name: data.name.trim(),
          slug: finalSlug,
          color: data.color || undefined,
          description: data.description?.trim(),
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
    const orderBy =
      sortBy === 'articles'
        ? { articles: { _count: 'desc' as const } }
        : { name: 'asc' as const };

    const where: any = {};
    if (search && search.trim()) {
      const searchTerm = search.trim();
      where.name = { contains: searchTerm, mode: 'insensitive' };
    }

    return this.prisma.blogTag.findMany({
      where,
      orderBy,
      include: includeCount
        ? {
            _count: {
              select: { articles: true },
            },
          }
        : undefined,
    });
  }

  /**
   * 获取热门标签
   */
  async getPopularTags(limit = 20) {
    return this.prisma.blogTag.findMany({
      take: limit,
      orderBy: {
        articles: { _count: 'desc' },
      },
      include: {
        _count: {
          select: { articles: true },
        },
      },
    });
  }

  /**
   * 获取标签详情
   */
  async getTag(id: string) {
    const tag = await this.prisma.blogTag.findUnique({
      where: { id },
      include: {
        _count: {
          select: { articles: true },
        },
      },
    });

    if (!tag) {
      throw new NotFoundException('标签不存在');
    }

    return tag;
  }

  /**
   * 更新标签
   */
  async updateTag(
    id: string,
    data: {
      name?: string;
      slug?: string;
      color?: string;
      description?: string;
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
