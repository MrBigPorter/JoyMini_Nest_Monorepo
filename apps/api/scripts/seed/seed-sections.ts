// scripts/seed/seed-sections.ts
/**
 * 活动专区 (ActSection) × 2  +  专区-产品关联 (ActSectionItem)
 *
 *  HOT_PICKS    🔥 Hot Picks    → JM-001, JM-002, JM-007, JM-008
 *  NEW_ARRIVALS ✨ New Arrivals → JM-005, JM-006, JM-003, JM-004
 *
 * imgStyleType: 0=标准卡片  1=大图横滑  2=小图列表
 * 幂等: ActSection 按 key (@unique) upsert；ActSectionItem 按 (sectionId, treasureId) 查重
 */
import { PrismaClient } from '@prisma/client';
import { createTreasureResolver, TreasureRefInput } from './treasure-ref';

const db = new PrismaClient();
const resolveTreasure = createTreasureResolver(db);

type SectionSeed = {
  key: string;
  title: string;
  imgStyleType: number;
  status: number;
  sortOrder: number;
  limit: number;
  items: TreasureRefInput[];
};

const SECTIONS: SectionSeed[] = [
  {
    key: 'HOT_PICKS',
    title: '🔥 Hot Picks',
    imgStyleType: 0,
    status: 1,
    sortOrder: 1,
    limit: 8,
    items: [
      'JM-001',
      { seq: 'JM-002' },
      { treasureSeq: 'JM-007' },
      '/pages/treasure/detail?seq=JM-008',
    ],
  },
  {
    key: 'NEW_ARRIVALS',
    title: '✨ New Arrivals',
    imgStyleType: 0,
    status: 1,
    sortOrder: 2,
    limit: 8,
    items: [
      'JM-005',
      { keyword: 'Dyson Supersonic HD15 Hair Dryer' },
      { treasureName: 'Sony PlayStation 5 Slim + 3 Games Bundle' },
      'JM-004',
    ],
  },
];

export async function seedActSections() {
  let sCreated = 0;
  let iCreated = 0;
  let missed = 0;

  for (const { items, ...sData } of SECTIONS) {
    // upsert section（key 是 @unique）
    const existing = await db.actSection.findUnique({
      where: { key: sData.key },
    });
    let sectionId: string;
    if (existing) {
      sectionId = existing.id;
    } else {
      const s = await db.actSection.create({ data: sData });
      sectionId = s.id;
      sCreated++;
    }

    // 支持 seq / id / name / url 等多种引用格式；并按 section.limit 截断
    const dedupedTreasureIds = new Set<string>();
    let sortOrder = 1;

    for (const ref of items) {
      if (sortOrder > sData.limit) break;

      const t = await resolveTreasure.resolve(ref);
      if (!t) {
        missed++;
        console.log(
          `  ⚠️ ActSectionItem unresolved (${sData.key}): ${JSON.stringify(ref)}`,
        );
        continue;
      }

      if (dedupedTreasureIds.has(t.treasureId)) {
        continue;
      }
      dedupedTreasureIds.add(t.treasureId);

      const exists = await db.actSectionItem.findFirst({
        where: { sectionId, treasureId: t.treasureId },
      });

      if (!exists) {
        await db.actSectionItem.create({
          data: { sectionId, treasureId: t.treasureId, sortOrder },
        });
        iCreated++;
      } else if (exists.sortOrder !== sortOrder) {
        await db.actSectionItem.update({
          where: { id: exists.id },
          data: { sortOrder },
        });
      }

      sortOrder++;
    }
  }

  console.log(`   ActSection       +${sCreated} new`);
  console.log(`   ActSectionItem   +${iCreated} new`);
  if (missed > 0) {
    console.log(`  ⚠️ ActSectionItem    ${missed} unresolved refs`);
  }
}
