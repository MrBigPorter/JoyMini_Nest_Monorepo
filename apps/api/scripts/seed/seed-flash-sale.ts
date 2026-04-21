// scripts/seed/seed-flash-sale.ts
/**
 * 秒杀场次 (FlashSaleSession) × 1  +  秒杀商品 (FlashSaleProduct) × 3
 *
 * 场次: "Tonight's Flash Sale"  运行 seed 后 2h 开始，持续 4h
 *
 * 秒杀商品 (flashPrice < unitAmount):
 *   JM-007  Xiaomi Air Fryer ₱100 → ₱ 60/份   库存 30份
 *   JM-008  Switch OLED      ₱200 → ₱120/份   库存 50份
 *   JM-009  Android Tablet   ₱ 60 → ₱ 45/份   库存 90份
 *
 * flashStock : 秒杀专属库存份数，与主产品 seqShelvesQuantity 相互独立
 * flashPrice : 秒杀价，单位 PHP/份
 *
 * 幂等: 按 title 查找 session；按 (sessionId, treasureId) 查找 product
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const hoursLater = (h: number) => new Date(Date.now() + h * 3_600_000);

const SESSION_TITLE = "⚡ Tonight's Flash Sale";

const FLASH_PRODUCTS: Array<{
  seq: string;
  flashPrice: number;
  flashStock: number;
  sortOrder: number;
}> = [
  // 优先使用 img.joyminis.com 资源的产品，避免首屏缩略图加载失败
  { seq: 'JM-007', flashPrice: 60, flashStock: 30, sortOrder: 1 },
  { seq: 'JM-008', flashPrice: 120, flashStock: 50, sortOrder: 2 },
  { seq: 'JM-009', flashPrice: 45, flashStock: 90, sortOrder: 3 },
];

export async function seedFlashSale() {
  // ── FlashSaleSession ──────────────────────────────────────
  let session = await db.flashSaleSession.findFirst({
    where: { title: SESSION_TITLE },
  });
  let sCreated = 0;
  if (!session) {
    session = await db.flashSaleSession.create({
      data: {
        title: SESSION_TITLE,
        startTime: hoursLater(2), // 2h 后开始
        endTime: hoursLater(6), // 4h 持续
        status: 1,
      },
    });
    sCreated++;
  }

  // ── FlashSaleProduct ──────────────────────────────────────
  let pCreated = 0;
  let pUpdated = 0;
  for (const { seq, flashPrice, flashStock, sortOrder } of FLASH_PRODUCTS) {
    const t = await db.treasure.findUnique({ where: { treasureSeq: seq } });
    if (!t) continue;

    // 以 sortOrder 作为稳定槽位，保证重复 seed 可修复旧数据
    const slot = await db.flashSaleProduct.findFirst({
      where: { sessionId: session.id, sortOrder },
    });

    if (!slot) {
      await db.flashSaleProduct.create({
        data: {
          sessionId: session.id,
          treasureId: t.treasureId,
          flashPrice,
          flashStock,
          sortOrder,
        },
      });
      pCreated++;
      continue;
    }

    if (
      slot.treasureId !== t.treasureId ||
      slot.flashPrice.toString() !== String(flashPrice) ||
      slot.flashStock !== flashStock
    ) {
      await db.flashSaleProduct.update({
        where: { id: slot.id },
        data: {
          treasureId: t.treasureId,
          flashPrice,
          flashStock,
        },
      });
      pUpdated++;
    }
  }

  console.log(`   FlashSaleSession +${sCreated} new`);
  console.log(`   FlashSaleProduct +${pCreated} new`);
  if (pUpdated > 0) {
    console.log(`  ♻️ FlashSaleProduct  ${pUpdated} updated`);
  }
}
