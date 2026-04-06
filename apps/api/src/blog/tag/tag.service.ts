import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class TagService {
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
    // Validate input
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Tag name is required');
    }

    if (data.name.trim().length > 100) {
      throw new Error('Tag name must be 100 characters or less');
    }

    if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
      throw new Error('Invalid color format. Use hex format like #3b82f6');
    }

    if (data.description && data.description.length > 300) {
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
    }

    // Ensure slug is not empty after processing
    if (!slug) {
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

      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    return this.prisma.blogTag.create({
      data: {
        name: data.name.trim(),
        slug: finalSlug,
        color: data.color || undefined,
        description: data.description?.trim(),
      },
    } as any);
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
    return this.prisma.blogTag.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除标签
   */
  async deleteTag(id: string) {
    // 自动解除所有文章关联
    const articles = await this.prisma.blogArticle.findMany({
      where: { tags: { some: { id } } },
      select: { id: true },
    });

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

    return this.prisma.blogTag.delete({
      where: { id },
    });
  }
}
