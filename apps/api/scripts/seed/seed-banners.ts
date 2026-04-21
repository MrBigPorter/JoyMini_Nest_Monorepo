// scripts/seed/seed-banners.ts
/**
 * Banner × 3
 *   1. 首页顶部轮播  — Flash Sale 主推   (bannerCate=1, position=0, showType=2)
 *   2. 首页中部单图  — 拼团入口          (bannerCate=1, position=1, showType=1)
 *   3. 活动页顶部    — 品牌大促活动       (bannerCate=2, position=0, showType=1)
 *
 * 字段枚举:
 *   bannerCate : 1=首页  2=活动页  3=产品页
 *   position   : 0=顶部  1=中部   2=底部
 *   fileType   : 1=图片  2=视频
 *   showType   : 1=单图  2=轮播
 *   jumpCate   : 1=无跳转  2=APP内页  3=产品详情  5=外链
 *
 * 幂等: 用 createdBy='seed' 作标记，已存在则整组跳过
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { createTreasureResolver, TreasureRefInput } from './treasure-ref';

const db = new PrismaClient();
const resolveTreasure = createTreasureResolver(db);
const SEED_MARKER = 'seed';
const daysLater = (d: number) => new Date(Date.now() + d * 86_400_000);

type SeedBannerRow = {
  title: string;
  bannerImgUrl: string;
  fileType: number;
  bannerCate: number;
  position: number;
  sortOrder: number;
  showType: number;
  jumpCate: number;
  jumpUrl?: string;
  state: number;
  validState: number;
  createdBy: string;
  bannerArray?: Prisma.InputJsonValue;
  activityAtStart?: Date;
  activityAtEnd?: Date;
  productRef?: TreasureRefInput;
};

export async function seedBanners() {
  const already = await db.banner.count({ where: { createdBy: SEED_MARKER } });
  if (already > 0) {
    console.log(`  ⏭️  Banner           skipped (${already} already exist)`);
    return;
  }

  const rows: SeedBannerRow[] = [
    // ── 首页顶部轮播 ────────────────────────────────────────
    {
      title: '⚡ Flash Sale — Up to 60% OFF',
      bannerImgUrl:
        'https://img.joyminis.com/images/c524a9db-9f49-4778-b6fc-fe45c5dd0690.png',
      fileType: 1,
      bannerCate: 1,
      position: 0,
      sortOrder: 1,
      showType: 2, // 轮播
      jumpCate: 3,
      jumpUrl: '/pages/goods/detail?seq=JM-008',
      productRef: 'JM-008',
      state: 1,
      validState: 1,
      createdBy: SEED_MARKER,
      // bannerArray: 轮播每帧 {img, url}
      bannerArray: [],
    },
    // ── 首页中部单图 ────────────────────────────────────────
    {
      title: '👥 Group Buy & Win Together',
      bannerImgUrl:
        'https://img.joyminis.com/images/292bd34b-ce86-4769-8743-0b41dfe7703b.png',
      fileType: 1,
      bannerCate: 1,
      position: 1,
      sortOrder: 2,
      showType: 1,
      jumpCate: 3,
      jumpUrl: '/pages/goods/detail?seq=JM-007',
      productRef: { seq: 'JM-007' },
      state: 1,
      validState: 1,
      createdBy: SEED_MARKER,
    },
    // ── 活动页顶部 ──────────────────────────────────────────
    {
      title: '🎉 JoyMinis Grand Lucky Draw',
      bannerImgUrl:
        'https://img.joyminis.com/images/9c28188f-709c-4900-8eb2-98df4c64c588.png',
      fileType: 1,
      bannerCate: 2,
      position: 0,
      sortOrder: 1,
      showType: 1,
      jumpCate: 5, // 外链
      jumpUrl: 'https://joyminis.com/grand-event',
      activityAtStart: new Date(),
      activityAtEnd: daysLater(30),
      state: 1,
      validState: 1,
      createdBy: SEED_MARKER,
    },
  ];

  let linked = 0;
  let unresolved = 0;

  for (const { productRef, ...row } of rows) {
    let relatedTitleId: string | undefined;
    let jumpCate = row.jumpCate;

    if (row.jumpCate === 3 && productRef) {
      const t = await resolveTreasure.resolve(productRef);
      if (t) {
        relatedTitleId = t.treasureId;
        linked++;
      } else {
        unresolved++;
        jumpCate = 2;
        console.log(
          `  ⚠️ Banner unresolved productRef: ${JSON.stringify(productRef)} (${row.title})`,
        );
      }
    }

    await db.banner.create({
      data: {
        ...row,
        jumpCate,
        ...(relatedTitleId ? { relatedTitleId } : {}),
      },
    });
  }

  console.log(`   Banner           +${rows.length} new`);
  if (linked > 0 || unresolved > 0) {
    console.log(
      `  🔗 Banner product   ${linked} linked, ${unresolved} unresolved`,
    );
  }
}
