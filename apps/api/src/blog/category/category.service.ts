import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建分类
   */
  async createCategory(data: {
    name: string;
    slug?: string;
    description?: string;
    parentId?: string;
  }) {
    let slug = data.slug;

    if (!slug) {
      slug = data.name
        .toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
        .replace(/\s+/g, '-');
    }

    return this.prisma.blogCategory.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        parentId: data.parentId,
      },
    });
  }

  /**
   * 更新分类
   */
  async updateCategory(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      parentId?: string;
    },
  ) {
    return this.prisma.blogCategory.update({
      where: { id },
      data,
    });
  }

  /**
   * 获取分类列表
   */
  async getCategories(includeCount = true, search?: string) {
    const where: any = {};
    if (search && search.trim()) {
      const searchTerm = search.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    return this.prisma.blogCategory.findMany({
      where,
      orderBy: { name: 'asc' },
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
   * 获取分类详情
   */
  async getCategory(id: string) {
    const category = await this.prisma.blogCategory.findUnique({
      where: { id },
      include: {
        _count: {
          select: { articles: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('分类不存在');
    }

    return category;
  }

  /**
   * 删除分类
   */
  async deleteCategory(id: string) {
    // 移动该分类下的文章到未分类
    await this.prisma.blogArticle.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });

    return this.prisma.blogCategory.delete({
      where: { id },
    });
  }
}
