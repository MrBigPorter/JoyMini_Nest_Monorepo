// scripts/seed/seed-ads.ts
/**
 * Advertisement (广告位) × 3
 *   1. 首页顶部广告  (adPosition=1)
 *   2. 分类页广告    (adPosition=3)
 *   3. 详情页底部广告 (adPosition=4)
 *
 * adPosition : 1=首页顶  2=首页中  3=分类页  4=详情页
 * fileType   : 1=图片    2=视频
 * sortType   : 1=单图    2=三图
 *
 * 幂等: 按 title 查重
 */
import { PrismaClient } from '@prisma/client';
import {
  createTreasureResolver,
  TreasureRefInput,
} from './treasure-ref';

const db = new PrismaClient();
const resolveTreasure = createTreasureResolver(db);
const daysLater = (d: number) => new Date(Date.now() + d * 86_400_000);

type SeedAd = {
  title: string;
  img: string;
  fileType: number;
  adPosition: number;
  sortOrder: number;
  sortType: number;
  jumpCate: number;
  jumpUrl: string;
  startTime: Date;
  endTime: Date;
  status: number;
  productRef?: TreasureRefInput;
};

const ADS: SeedAd[] = [
  {
    title: 'JoyMinis — Win Big Every Day!',
    img: 'https://img.joyminis.com/images/treasure/ad-homepage-top.png',
    fileType: 1,
    adPosition: 1,
    sortOrder: 1,
    sortType: 1,
    jumpCate: 3,
    jumpUrl: '/pages/goods/detail?seq=JM-001',
    productRef: 'JM-001',
    startTime: new Date(),
    endTime: daysLater(90),
    status: 1,
  },
  {
    title: "Flash Sale Tonight — Don't Miss Out",
    img: 'https://img.joyminis.com/images/treasure/ad-category-flashsale.jpg',
    fileType: 1,
    adPosition: 3,
    sortOrder: 1,
    sortType: 1,
    jumpCate: 3,
    jumpUrl: '/pages/goods/detail?seq=JM-008',
    productRef: { seq: 'JM-008' },
    startTime: new Date(),
    endTime: daysLater(7),
    status: 1,
  },
  {
    title: 'Invite Friends, Earn ₱50 Bonus',
    img: 'https://img.joyminis.com/images/treasure/ad-detail-referral.jpg',
    fileType: 1,
    adPosition: 4,
    sortOrder: 1,
    sortType: 1,
    jumpCate: 3,
    jumpUrl: '/pages/goods/detail?seq=JM-007',
    productRef: { treasureSeq: 'JM-007' },
    startTime: new Date(),
    endTime: daysLater(90),
    status: 1,
  },
];

export async function seedAdvertisements() {
  let created = 0;
  let linked = 0;
  let unresolved = 0;
  for (const ad of ADS) {
    const { productRef, ...base } = ad;
    const e = await db.advertisement.findFirst({ where: { title: ad.title } });
    if (!e) {
      let relatedId: string | undefined;
      let jumpCate = base.jumpCate;

      if (base.jumpCate === 3 && productRef) {
        const t = await resolveTreasure.resolve(productRef);
        if (t) {
          relatedId = t.treasureId;
          linked++;
        } else {
          unresolved++;
          jumpCate = 2;
          console.log(
            `  ⚠️ Advertisement unresolved productRef: ${JSON.stringify(productRef)} (${base.title})`,
          );
        }
      }

      await db.advertisement.create({
        data: {
          ...base,
          jumpCate,
          ...(relatedId ? { relatedId } : {}),
        },
      });
      created++;
    }
  }
  console.log(`   Advertisement    +${created} new`);
  if (linked > 0 || unresolved > 0) {
    console.log(`  🔗 Advertisement    ${linked} linked, ${unresolved} unresolved`);
  }
}
