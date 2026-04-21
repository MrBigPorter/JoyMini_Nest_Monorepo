// apps/api/scripts/seed/seed-lucky-draw.ts
/**
 * Lucky Draw demo data
 *
 * - Activities × 2
 *   1) Global activity (treasureId = null)
 *   2) Treasure-scoped activity (JM-001)
 * - Prizes × 8 (4 per activity, probability sum = 100)
 *
 * Idempotency:
 * - Activity: find by (title + treasureId)
 * - Prize: find by (activityId + sortOrder + prizeType)
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

type PrizeSeed = {
  prizeType: 1 | 2 | 3 | 4;
  prizeName: string;
  couponCode?: string;
  prizeValue?: number;
  probability: number;
  stock: number;
  sortOrder: number;
};

async function ensureActivity(params: {
  title: string;
  description: string;
  treasureId: string | null;
  status: number;
  startAt: Date | null;
  endAt: Date | null;
}) {
  const existing = await db.luckyDrawActivity.findFirst({
    where: {
      title: params.title,
      treasureId: params.treasureId,
    },
  });

  if (existing) {
    await db.luckyDrawActivity.update({
      where: { id: existing.id },
      data: {
        description: params.description,
        status: params.status,
        startAt: params.startAt,
        endAt: params.endAt,
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await db.luckyDrawActivity.create({
    data: params,
    select: { id: true },
  });

  return { id: created.id, created: true };
}

async function upsertPrize(activityId: string, prize: PrizeSeed) {
  let couponId: string | undefined;
  if (prize.couponCode) {
    const coupon = await db.coupon.findUnique({
      where: { couponCode: prize.couponCode },
      select: { id: true },
    });
    if (!coupon) {
      throw new Error(`Coupon code not found: ${prize.couponCode}`);
    }
    couponId = coupon.id;
  }

  const existing = await db.luckyDrawPrize.findFirst({
    where: {
      activityId,
      sortOrder: prize.sortOrder,
      prizeType: prize.prizeType,
    },
    select: { id: true },
  });

  const data = {
    activityId,
    prizeType: prize.prizeType,
    prizeName: prize.prizeName,
    couponId: couponId ?? null,
    prizeValue: prize.prizeValue ?? null,
    probability: prize.probability,
    stock: prize.stock,
    sortOrder: prize.sortOrder,
  };

  if (existing) {
    await db.luckyDrawPrize.update({ where: { id: existing.id }, data });
    return false;
  }

  await db.luckyDrawPrize.create({ data });
  return true;
}

function assertProbability(prizes: PrizeSeed[]) {
  const total = prizes.reduce((sum, p) => sum + p.probability, 0);
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(
      `LuckyDraw prize probabilities must sum to 100, got ${total}`,
    );
  }
}

async function seedLuckyDraw() {
  const treasure = await db.treasure.findUnique({
    where: { treasureSeq: 'JM-001' },
    select: { treasureId: true },
  });

  if (!treasure) {
    console.log('  ⚠️  LuckyDraw       skipped (JM-001 not found)');
    return;
  }

  const now = new Date();

  const globalActivity = await ensureActivity({
    title: 'Global Lucky Draw',
    description: 'Any successful order can earn one free draw ticket.',
    treasureId: null,
    status: 1,
    startAt: now,
    endAt: null,
  });

  const iphoneActivity = await ensureActivity({
    title: 'iPhone Bonus Lucky Draw',
    description: 'Extra lucky draw rewards for JM-001 related orders.',
    treasureId: treasure.treasureId,
    status: 1,
    startAt: now,
    endAt: null,
  });

  const globalPrizes: PrizeSeed[] = [
    {
      prizeType: 4,
      prizeName: 'Better Luck Next Time',
      probability: 24,
      stock: -1,
      sortOrder: 1,
    },
    {
      prizeType: 4,
      prizeName: 'Almost There',
      probability: 16,
      stock: -1,
      sortOrder: 2,
    },
    {
      prizeType: 4,
      prizeName: 'Keep Going',
      probability: 12,
      stock: -1,
      sortOrder: 3,
    },
    {
      prizeType: 2,
      prizeName: '20 Coins',
      prizeValue: 20,
      probability: 10,
      stock: -1,
      sortOrder: 4,
    },
    {
      prizeType: 2,
      prizeName: '50 Coins',
      prizeValue: 50,
      probability: 8,
      stock: -1,
      sortOrder: 5,
    },
    {
      prizeType: 2,
      prizeName: '80 Coins',
      prizeValue: 80,
      probability: 7,
      stock: -1,
      sortOrder: 6,
    },
    {
      prizeType: 2,
      prizeName: '100 Coins',
      prizeValue: 100,
      probability: 5,
      stock: -1,
      sortOrder: 7,
    },
    {
      prizeType: 3,
      prizeName: 'PHP 5 Wallet Bonus',
      prizeValue: 5,
      probability: 4,
      stock: -1,
      sortOrder: 8,
    },
    {
      prizeType: 3,
      prizeName: 'PHP 8 Wallet Bonus',
      prizeValue: 8,
      probability: 3,
      stock: -1,
      sortOrder: 9,
    },
    {
      prizeType: 2,
      prizeName: '150 Coins',
      prizeValue: 150,
      probability: 3,
      stock: -1,
      sortOrder: 10,
    },
    {
      prizeType: 3,
      prizeName: 'PHP 10 Wallet Bonus',
      prizeValue: 10,
      probability: 2,
      stock: -1,
      sortOrder: 11,
    },
    {
      prizeType: 2,
      prizeName: '200 Coins',
      prizeValue: 200,
      probability: 2,
      stock: -1,
      sortOrder: 12,
    },
    {
      prizeType: 3,
      prizeName: 'PHP 20 Wallet Bonus',
      prizeValue: 20,
      probability: 1,
      stock: -1,
      sortOrder: 13,
    },
    {
      prizeType: 2,
      prizeName: '500 Coins Jackpot',
      prizeValue: 500,
      probability: 1,
      stock: -1,
      sortOrder: 14,
    },
    {
      prizeType: 2,
      prizeName: 'Lucky Surprise Bonus (300 Coins)',
      prizeValue: 300,
      probability: 2,
      stock: -1,
      sortOrder: 15,
    },
  ];

  const iphonePrizes: PrizeSeed[] = [
    {
      prizeType: 1,
      prizeName: 'BIG200 Coupon',
      couponCode: 'BIG200',
      probability: 5,
      stock: 200,
      sortOrder: 1,
    },
    {
      prizeType: 2,
      prizeName: '500 Coins',
      prizeValue: 500,
      probability: 15,
      stock: -1,
      sortOrder: 2,
    },
    {
      prizeType: 3,
      prizeName: 'PHP 100 Wallet Bonus',
      prizeValue: 100,
      probability: 10,
      stock: 100,
      sortOrder: 3,
    },
    {
      prizeType: 4,
      prizeName: 'Better Luck Next Time',
      probability: 70,
      stock: -1,
      sortOrder: 4,
    },
  ];

  assertProbability(globalPrizes);
  assertProbability(iphonePrizes);

  let prizeCreated = 0;
  for (const p of globalPrizes) {
    if (await upsertPrize(globalActivity.id, p)) prizeCreated++;
  }
  for (const p of iphonePrizes) {
    if (await upsertPrize(iphoneActivity.id, p)) prizeCreated++;
  }

  const activityCreated = [globalActivity, iphoneActivity].filter(
    (item) => item.created,
  ).length;

  console.log(`   LuckyDrawActivity +${activityCreated} new`);
  console.log(`   LuckyDrawPrize    +${prizeCreated} new`);
}

export { seedLuckyDraw };
export default seedLuckyDraw;
