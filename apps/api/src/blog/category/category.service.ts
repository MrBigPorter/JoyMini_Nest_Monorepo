import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { SystemConfigService } from '@api/admin/system-config/system-config.service';

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

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
    this.logger.log(`Creating category with data: ${JSON.stringify(data)}`);

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

      this.logger.log(`Generated slug from name: ${slug}`);
    }

    try {
      const category = await this.prisma.blogCategory.create({
        data: {
          name: data.name,
          slug,
          description: data.description,
          parentId: data.parentId,
        },
      });

      this.logger.log(
        `Category created successfully: ${category.id} - ${slug}`,
      );
      return category;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to create category: ${errorMessage}`, stack);
      throw error;
    }
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
    this.logger.log(
      `Updating category ${id} with data: ${JSON.stringify(data)}`,
    );

    try {
      const category = await this.prisma.blogCategory.update({
        where: { id },
        data,
      });

      this.logger.log(`Category ${id} updated successfully`);
      return category;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to update category ${id}: ${errorMessage}`,
        stack,
      );
      throw error;
    }
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

    const categories = await this.prisma.blogCategory.findMany({
      where,
      orderBy: { name: 'asc' },
      include: includeCount
        ? {
            articles: {
              where: { status: 'PUBLISHED' },
              select: { id: true },
            },
          }
        : undefined,
    });

    if (includeCount) {
      return categories.map((cat: any) => {
        const { articles, ...rest } = cat;
        return {
          ...rest,
          _count: {
            articles: articles.length,
          },
        };
      });
    }

    return categories;
  }

  /**
   * 获取分类详情
   */
  async getCategory(id: string) {
    this.logger.log(`Getting category details for id: ${id}`);

    try {
      const category = await this.prisma.blogCategory.findUnique({
        where: { id },
        include: {
          articles: {
            where: { status: 'PUBLISHED' },
            select: { id: true },
          },
        },
      });

      if (!category) {
        this.logger.warn(`Category not found: ${id}`);
        throw new NotFoundException('分类不存在');
      }

      const { articles, ...rest } = category;
      const result = {
        ...rest,
        _count: {
          articles: articles.length,
        },
      };

      this.logger.log(
        `Category found: ${id} with ${result._count.articles} articles`,
      );
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get category ${id}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 删除分类
   */
  async deleteCategory(id: string) {
    this.logger.log(`Deleting category: ${id}`);

    try {
      // 移动该分类下的文章到未分类（categoryId = null）
      const updateResult = await this.prisma.blogArticle.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      });

      this.logger.log(
        `Moved ${updateResult.count} articles from category ${id} to uncategorized`,
      );

      const deletedCategory = await this.prisma.blogCategory.delete({
        where: { id },
      });

      this.logger.log(`Category deleted successfully: ${id}`);
      return deletedCategory;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to delete category ${id}: ${errorMessage}`,
        stack,
      );
      throw error;
    }
  }
}
