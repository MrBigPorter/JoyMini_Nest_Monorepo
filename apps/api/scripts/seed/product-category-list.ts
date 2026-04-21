// apps/api/scripts/seed/product-category-list.ts
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/**
 * 产品分类 × 6
 * 幂等：按 name 查重，已存在则跳过
 * 返回 name → id 映射，供其他 seed 模块使用
 */
export async function seedProductCategories(): Promise<Record<string, number>> {
  // 图片素材尚未就绪：先允许 icon 为空，后续只改这里即可统一回填。
  const legacyNameMap: Record<string, string> = {
    'Home Appliances': 'Home',
    'Fashion & Lifestyle': 'Fashion',
    'Sports & Outdoor': 'Sports',
    'Beauty & Health': 'Beauty',
    Phone: 'Electronics',
    Gadget: 'Electronics',
    Game: 'Electronics',
    Voucher: 'Lifestyle',
    'Cash Prizes': 'Lifestyle',
    Cash: 'Lifestyle',
  };

  const rows = [
    {
      name: 'Electronics',
      nameEn: 'Electronics',
      icon: null,
      sortOrder: 1,
    },
    {
      name: 'Home',
      nameEn: 'Home',
      icon: null,
      sortOrder: 2,
    },
    {
      name: 'Fashion',
      nameEn: 'Fashion',
      icon: null,
      sortOrder: 3,
    },
    {
      name: 'Sports',
      nameEn: 'Sports',
      icon: null,
      sortOrder: 4,
    },
    {
      name: 'Beauty',
      nameEn: 'Beauty',
      icon: null,
      sortOrder: 5,
    },
    {
      name: 'Lifestyle',
      nameEn: 'Lifestyle',
      icon: null,
      sortOrder: 6,
    },
  ];

  let created = 0;
  const idMap: Record<string, number> = {};

  for (const row of rows) {
    const e = await db.productCategory.findFirst({ where: { name: row.name } });
    if (e) {
      idMap[row.name] = e.id;

      const hasLegacySeedIcon =
        typeof e.icon === 'string' &&
        e.icon.startsWith('https://cdn.joyminis.com/icons/cat-');

      if (hasLegacySeedIcon && row.icon === null) {
        await db.productCategory.update({
          where: { id: e.id },
          data: { icon: null },
        });
        continue;
      }

      // 若后续补齐 icon，可通过更新 rows 中 icon 一次性回填空值数据。
      if (!e.icon && row.icon) {
        await db.productCategory.update({
          where: { id: e.id },
          data: { icon: row.icon },
        });
      }
    } else {
      const r = await db.productCategory.create({ data: row });
      idMap[row.name] = r.id;
      created++;
    }
  }

  for (const [legacyName, targetName] of Object.entries(legacyNameMap)) {
    const legacy = await db.productCategory.findFirst({
      where: { name: legacyName },
      select: { id: true },
    });
    const target = await db.productCategory.findFirst({
      where: { name: targetName },
      select: { id: true },
    });

    if (!legacy || !target || legacy.id === target.id) continue;

    const links = await db.treasureCategory.findMany({
      where: { categoryId: legacy.id },
      select: { id: true, treasureId: true },
    });

    for (const link of links) {
      const targetLink = await db.treasureCategory.findFirst({
        where: { treasureId: link.treasureId, categoryId: target.id },
        select: { id: true },
      });

      if (targetLink) {
        await db.treasureCategory.delete({ where: { id: link.id } });
      } else {
        await db.treasureCategory.update({
          where: { id: link.id },
          data: { categoryId: target.id },
        });
      }
    }

    await db.productCategory.delete({ where: { id: legacy.id } });
  }

  console.log(`   ProductCategory  +${created} new`);
  return idMap;
}
