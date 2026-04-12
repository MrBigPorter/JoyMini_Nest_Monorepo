import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';

@Injectable()
export class CategoryService {
  constructor(
    private prisma: PrismaService,
    private systemConfigService: SystemConfigService,
  ) {}

  /**
   * 创建分类
   */
  async createCategory(data: {
    name: Record<string, string | undefined>;
    slug?: string;
    description?: Record<string, string | undefined>;
    parentId?: string;
  }) {
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
      name?: Record<string, string | undefined>;
      slug?: string;
      description?: Record<string, string | undefined>;
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
