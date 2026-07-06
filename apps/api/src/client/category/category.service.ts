import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { CategoryQueryDto } from '@api/client/category/dto/category-query.dto';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: CategoryQueryDto) {
    const { state, withCounts } = query;

    const where = typeof state === 'number' ? { state } : undefined;

    const categories = await this.prisma.productCategory.findMany({
      where,
      select: { id: true, name: true, state: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    if (!withCounts) {
      return categories;
    }

    // 统计每个分类下有多少商品
    const grouped = await this.prisma.treasureCategory.groupBy({
      by: ['categoryId'],
      _count: { categoryId: true },
      where: where ? { category: where } : undefined,
    });

    const counts = new Map<number, number>(
      grouped.map((g) => [g.categoryId, g._count.categoryId]),
    );

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state,
      sortOrder: c.sortOrder,
      count: counts.get(c.id) ?? 0,
    }));
  }
}
