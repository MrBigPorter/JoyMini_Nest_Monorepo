// apps/api/scripts/seed/seed-treasures.ts
/**
 * 抽奖产品 (Treasure) × 30  +  产品-分类关联 (TreasureCategory)
 *
 * 编号  产品名称                              价格     总份数  分类
 * JM-001  Apple iPhone 16 Pro 256GB         ₱250/份  300份  Electronics
 * JM-002  Samsung Galaxy S25 Ultra 512GB    ₱200/份  300份  Electronics
 * JM-003  Sony PS5 Slim + 3 Games Bundle    ₱150/份  200份  Electronics
 * JM-004  Dyson V15 Detect Vacuum           ₱100/份  150份  Home
 * JM-005  Nike Air Jordan 4 Retro (US10)    ₱ 50/份  100份  Fashion
 * JM-006  Dyson Supersonic HD15 Hair Dryer  ₱ 80/份  125份  Beauty
 * JM-007  Xiaomi Smart Air Fryer 6L         ₱100/份   60份  Home
 * JM-008  Nintendo Switch OLED Bundle       ₱200/份   60份  Electronics
 * JM-009  Android Tablet 10.1" 8+128        ₱ 60/份  180份  Electronics
 * JM-010  Robot Vacuum & Mop 3-in-1         ₱ 70/份  160份  Home
 * JM-011  Digital Air Fryer 5L              ₱ 40/份  150份  Home
 * JM-012  IP68 Fitness Smart Watch          ₱ 35/份  140份  Sports
 * JM-013  Women Crossbody Bag Set           ₱ 25/份  120份  Fashion
 * JM-014  Adjustable Dumbbell Set           ₱ 45/份  150份  Sports
 * JM-015  Mini Portable Projector           ₱ 55/份  160份  Electronics
 * JM-016  Anker MagGo Power Bank            ₱ 30/份  140份  Electronics
 * JM-017  Nespresso Essenza Mini Bundle     ₱ 65/份  150份  Home
 * JM-018  Samsonite Cabin Luggage 20"       ₱ 55/份  150份  Lifestyle
 * JM-019  JBL Flip 7 Speaker                ₱ 45/份  150份  Electronics
 * JM-020  New Balance 530 Sneakers          ₱ 50/份  120份  Fashion
 * JM-021  Makeup Vanity Gift Kit            ₱ 28/份  140份  Beauty
 * JM-022  Deep Tissue Massage Gun Set       ₱ 48/份  140份  Sports
 * JM-023  Tefal Cookware 10-Piece Set       ₱ 42/份  160份  Home
 * JM-024  Adidas Gym Duffel Bundle          ₱ 30/份  130份  Sports
 * JM-025  L'Oréal Skincare Gift Box         ₱ 26/份  120份  Beauty
 * JM-026  Fossil Leather Satchel            ₱ 38/份  130份  Fashion
 * JM-027  American Tourister Luggage 24"    ₱ 52/份  150份  Lifestyle
 * JM-028  Xiaomi Smart Band 9 Combo         ₱ 32/份  140份  Sports
 * JM-029  Sonic Electric Toothbrush Duo     ₱ 34/份  130份  Beauty
 * JM-030  Kindle Paperwhite 11th Gen        ₱ 58/份  150份  Lifestyle
 *
 * 字段说明:
 *   unitAmount         每份价格（PHP）
 *   seqShelvesQuantity 总份数（总票数）
 *   soloAmount         单独购买价（前端显示）
 *   minBuyQuantity     触发开奖所需最低售出份数（售罄模式下 = seqShelvesQuantity）
 *   maxPerBuyQuantity  单人最大购买份数
 *   lotteryMode        1=售罄即开奖  2=定时开奖
 *   virtual            1=虚拟  2=实物
 *   shippingType       1=需发货      2=无需发货
 *   fakeSalesCount     虚拟已售数（热度展示用）
 *   marketAmount       市场参考价（前端展示）
 *   cashAmount         虚拟奖励金额（virtual=1 时有效）
 *   groupSize          成团所需人数
 *   groupTimeLimit     成团时效（秒）超时未满则解散/机器人补齐
 *   enableRobot        是否允许机器人自动补齐拼团
 *   robotDelay         机器人介入前等待秒数
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost();

const db = new PrismaClient();

const daysLater = (d: number) => new Date(Date.now() + d * 86_400_000);

// 拼团配置快捷常量
const G5 = { groupSize: 5, groupTimeLimit: 86_400 }; // 5人团，24h
const G3 = { groupSize: 3, groupTimeLimit: 86_400 }; // 3人团，24h

type TreasureSeed = {
  treasureSeq: string;
  treasureName: string;
  productName: string;
  treasureCoverImg: string;
  mainImageList: string[];
  unitAmount: number;
  marketAmount: number;
  soloAmount?: number;
  costAmount?: number;
  cashAmount?: number;
  seqShelvesQuantity: number;
  minBuyQuantity: number;
  maxPerBuyQuantity: number;
  lotteryMode: number;
  virtual: number;
  shippingType: number;
  fakeSalesCount: number;
  groupSize: number;
  groupTimeLimit: number;
  desc: string;
  ruleContent?: string;
  category: string;
};

type SeedTreasuresOptions = {
  resetBeforeSeed?: boolean;
};

const LEGACY_TREASURE_NAMES = [
  'iPad mini (Wifi 128GB)',
  'AirPods Pro (3rd Gen)',
  'Xiaomi Redmi Note 14',
  'Samsung Galaxy S25',
  '₱1,000 Shopping Voucher',
  '₱50,000 Grand Cash',
  '₱10,000 Mega Cash',
  '₱3,000 Cash Prize',
  'iPhone 16 (128GB)',
  '₱500 Steam Wallet Code',
  '₱1,000 Game Credits',
  'Smart Rice Cooker',
  'Dyson Supersonic Hair Dryer',
] as const;

const PRIZE_GUIDE_BASE_URL = 'https://img.joyminis.com/images/treasure';
const BONUS_GIFT_IMG_URL = 'https://img.joyminis.com/images/treasure/gift.jpg';
const BONUS_GIFT_NAME = 'Golden Surprise Gift Pack';

const PRIZE_EXPLAIN_BLOCK = [
  '<hr/>',
  '<h3>🎁 Bonus Reward Guide</h3>',
  '<p>Some activities include extra rewards in addition to the main product draw. The following images explain each reward type.</p>',
  '<div style="display:flex;flex-wrap:wrap;gap:12px;margin:12px 0">',
  `<div style="flex:1;min-width:180px"><img src="${PRIZE_GUIDE_BASE_URL}/coins.jpg" alt="Coins Reward" style="width:100%;border-radius:8px"/><p><strong>Coins Reward</strong><br/>Coins are credited to your account and can be used in eligible activities.</p></div>`,
  `<div style="flex:1;min-width:180px"><img src="${PRIZE_GUIDE_BASE_URL}/coupon.jpg" alt="Coupon Reward" style="width:100%;border-radius:8px"/><p><strong>Coupon Reward</strong><br/>Coupons appear in your account and can be applied at checkout based on coupon terms.</p></div>`,
  `<div style="flex:1;min-width:180px"><img src="${PRIZE_GUIDE_BASE_URL}/wallet-Bonus.png" alt="Wallet Bonus Reward" style="width:100%;border-radius:8px"/><p><strong>Wallet Bonus</strong><br/>Wallet bonus is direct balance credit and can be used according to platform wallet rules.</p></div>`,
  '</div>',
  '<p><em>Note: Bonus reward type, value, and probability are defined by each active Lucky Draw activity.</em></p>',
].join('');

function withPrizeGuide(ruleContent?: string): string {
  const base = ruleContent ?? '';
  if (
    base.includes('coins.jpg') ||
    base.includes('coupon.jpg') ||
    base.includes('wallet-Bonus.png')
  ) {
    return base;
  }
  return `${base}${PRIZE_EXPLAIN_BLOCK}`;
}

function normalizeRichHtmlForMobile(content?: string): string {
  const html = content ?? '';
  if (!html) return html;

  return html.replace(
    /<img\b([^>]*?)\/?>(?!\s*<\/img>)/gi,
    (_, attrs: string) => {
      const styleMatch = attrs.match(/\sstyle=(['"])(.*?)\1/i);

      if (!styleMatch) {
        return `<img${attrs} style="display:block;max-width:100%;height:auto;margin:0 0 12px 0" />`;
      }

      const quote = styleMatch[1];
      let style = styleMatch[2].trim();

      if (!/display\s*:\s*block/i.test(style)) style += ';display:block';
      if (!/max-width\s*:/i.test(style)) style += ';max-width:100%';
      if (!/height\s*:/i.test(style)) style += ';height:auto';

      const nextAttrs = attrs.replace(
        /\sstyle=(['"])(.*?)\1/i,
        ` style=${quote}${style}${quote}`,
      );

      return `<img${nextAttrs} />`;
    },
  );
}

async function resetTreasures(
  where: Prisma.TreasureWhereInput,
  label: string,
  labelField: 'treasureSeq' | 'treasureName',
): Promise<void> {
  const existing = await db.treasure.findMany({
    where,
    select: {
      treasureId: true,
      treasureSeq: true,
      treasureName: true,
      _count: {
        select: {
          orders: true,
          groups: true,
          luckyDrawActivities: true,
          flashSaleProducts: true,
          sectionItems: true,
        },
      },
    },
  });

  const deletable = existing.filter(
    (t) =>
      t._count.orders === 0 &&
      t._count.groups === 0 &&
      t._count.luckyDrawActivities === 0 &&
      t._count.flashSaleProducts === 0 &&
      t._count.sectionItems === 0,
  );
  const blocked = existing.filter((t) => !deletable.includes(t));

  if (deletable.length > 0) {
    const ids = deletable.map((t) => t.treasureId);
    await db.$transaction([
      db.treasureCategory.deleteMany({ where: { treasureId: { in: ids } } }),
      db.treasure.deleteMany({ where: { treasureId: { in: ids } } }),
    ]);
  }

  console.log(
    `  ♻️ ${label} -${deletable.length} deleted, ${blocked.length} kept`,
  );
  if (blocked.length > 0) {
    console.log(
      `     kept ${labelField === 'treasureSeq' ? 'seqs' : 'names'}: ${blocked
        .map((t) => t[labelField] ?? 'NULL')
        .join(', ')}`,
    );
  }
}

async function resetSeededTreasuresBySeq(seqs: string[]): Promise<void> {
  if (seqs.length === 0) return;

  await resetTreasures(
    { treasureSeq: { in: seqs } },
    'Treasure reset',
    'treasureSeq',
  );
}

async function resetLegacySeedTreasuresByName(
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) return;

  await resetTreasures(
    {
      treasureSeq: null,
      treasureName: { in: [...names] },
    },
    'Legacy treasure cleanup',
    'treasureName',
  );
}

const TREASURES: TreasureSeed[] = [
  // ─────────────────────────────────────────
  // Electronics
  // ─────────────────────────────────────────
  {
    treasureSeq: 'JM-001',
    treasureName: 'Apple iPhone 16 Pro 256GB',
    productName: 'iPhone 16 Pro 256GB Natural Titanium',
    treasureCoverImg:
      'https://cdn.joyminis.com/images/treasure/iphone16pro-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/iphone16pro-1.jpg',
      'https://cdn.joyminis.com/images/treasure/iphone16pro-2.jpg',
    ],
    unitAmount: 250,
    marketAmount: 75000,
    costAmount: 70000,
    seqShelvesQuantity: 300,
    minBuyQuantity: 300,
    maxPerBuyQuantity: 30,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 120,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/iphone16pro-1.jpg" alt="iPhone 16 Pro" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://cdn.joyminis.com/images/treasure/iphone16pro-2.jpg" alt="iPhone 16 Pro camera" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Apple iPhone 16 Pro 256GB — Natural Titanium</h3>',
      '<p>Experience the most powerful iPhone ever made. Powered by the A18 Pro chip on 3nm technology, it delivers unprecedented performance for gaming, AI tasks, and professional photography.</p>',
      '<p>The triple-camera system with 5× optical telephoto lets you capture stunning detail in any lighting. Record 4K 120fps Dolby Vision video straight from your pocket.</p>',
      '<ul>',
      '<li>📱 6.3-inch Super Retina XDR ProMotion display (1–120Hz)</li>',
      '<li>⚡ A18 Pro chip — 6-core GPU, desktop-class performance</li>',
      '<li>📷 48MP Fusion + 48MP Ultrawide + 12MP 5× Telephoto</li>',
      '<li>🎥 4K 120fps Dolby Vision video recording</li>',
      '<li>🔋 Up to 27 hours video playback battery life</li>',
      '<li>💾 256GB internal storage — thousands of photos and apps</li>',
      '<li>🔒 Face ID with premium titanium frame</li>',
      '<li>🌐 5G capable, Wi-Fi 7, USB 3 speeds via USB-C</li>',
      '</ul>',
      '<p><em>Brand new, sealed in original Apple box. International warranty applies.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× iPhone 16 Pro 256GB (Natural Titanium, factory sealed)</li>',
      '<li>1× USB-C Charge Cable (1m)</li>',
      '<li>Documentation and original Apple retail box</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱250 per share</li>',
      '<li>Once all 300 shares are sold, one winner is randomly selected</li>',
      '<li>Winner is announced within 24 hours and contacted via registered account</li>',
      "<li>Prize is shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 30 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  {
    treasureSeq: 'JM-002',
    treasureName: 'Samsung Galaxy S25 Ultra 512GB',
    productName: 'Samsung Galaxy S25 Ultra Titanium Gray 512GB',
    treasureCoverImg:
      'https://cdn.joyminis.com/images/treasure/s25ultra-cover.jpg',
    mainImageList: [
      'https://cdn.joyminis.com/product/images/s25ultra-1.jpg',
      'https://cdn.joyminis.com/product/images/s25ultra-2.jpg',
    ],
    unitAmount: 200,
    marketAmount: 60000,
    costAmount: 55000,
    seqShelvesQuantity: 300,
    minBuyQuantity: 300,
    maxPerBuyQuantity: 30,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 85,
    ...G5,
    desc: [
      '<img src="https://cdn.joyminis.com/product/images/s25ultra-1.jpg" alt="Samsung Galaxy S25 Ultra" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://cdn.joyminis.com/product/images/s25ultra-2.jpg" alt="Galaxy S25 Ultra S Pen" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Samsung Galaxy S25 Ultra 512GB — Titanium Gray</h3>',
      '<p>The ultimate Android powerhouse. Samsung Galaxy S25 Ultra raises the bar with a 200MP quad-camera system, a redesigned S Pen, and the blazing Snapdragon 8 Elite processor. Every photo, every task, every moment — elevated.</p>',
      '<p>With 512GB internal storage and 12GB RAM, this phone handles anything you throw at it — from 8K video recording to multi-app productivity without a slowdown.</p>',
      '<ul>',
      '<li>📱 6.9-inch Dynamic AMOLED 2X display, 2600 nits brightness</li>',
      '<li>⚡ Snapdragon 8 Elite — fastest Android chip available</li>',
      '<li>📷 200MP main + 50MP ultrawide + 10MP 3× + 50MP 5× telephoto</li>',
      '<li>🎥 8K video recording with advanced stabilization</li>',
      '<li>✏️ Integrated S Pen with ultra-low latency writing</li>',
      '<li>🔋 5000mAh battery with 45W fast charging</li>',
      '<li>💾 512GB storage — 4× more space for your life</li>',
      '<li>🛡️ Titanium frame + Gorilla Glass Armor</li>',
      '</ul>',
      '<p><em>Brand new, sealed in original Samsung box. International warranty applies.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Samsung Galaxy S25 Ultra 512GB (Titanium Gray, sealed)</li>',
      '<li>1× 45W USB-C Super Fast Charging cable</li>',
      '<li>Original Samsung retail packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱200 per share</li>',
      '<li>Once all 300 shares are sold, one winner is randomly selected</li>',
      '<li>Winner is announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 30 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  {
    treasureSeq: 'JM-003',
    treasureName: 'Sony PlayStation 5 Slim + 3 Games Bundle',
    productName: 'PS5 Slim + EA FC25 + Spider-Man 2 + God of War Ragnarök',
    treasureCoverImg:
      'https://cdn.joyminis.com/images/treasure/ps5slim-cover.jpg',
    mainImageList: [
      'https://cdn.joyminis.com/images/treasure/ps5slim-1.jpg',
      'https://cdn.joyminis.com/images/treasure/ps5slim-2.jpg',
    ],
    unitAmount: 150,
    marketAmount: 30000,
    costAmount: 27000,
    seqShelvesQuantity: 200,
    minBuyQuantity: 200,
    maxPerBuyQuantity: 20,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 64,
    ...G3,
    desc: [
      '<img src="https://cdn.joyminis.com/images/treasure/ps5slim-1.jpg" alt="Sony PS5 Slim Console" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://cdn.joyminis.com/images/treasure/ps5slim-2.jpg" alt="PS5 Slim with games" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Sony PlayStation 5 Slim + 3 Games Bundle</h3>',
      "<p>The PS5 Slim is Sony's slimmest console ever — 30% smaller than the original PS5, with no compromise on performance. Experience next-gen gaming with ultra-high-speed SSD, ray tracing visuals, and 3D audio immersion.</p>",
      "<p>This bundle includes three of the most iconic PlayStation games of the generation — EA FC25, Marvel's Spider-Man 2, and God of War Ragnarök — giving you hundreds of hours of gameplay right out of the box.</p>",
      '<ul>',
      '<li>🎮 Sony PlayStation 5 Slim — next-gen performance in a smaller form factor</li>',
      '<li>⚡ Ultra-high-speed SSD (5.5 GB/s) — near-instant load times</li>',
      '<li>🖼️ 4K gaming at 60fps, up to 8K output support</li>',
      '<li>🎵 Tempest 3D AudioTech for immersive spatial sound</li>',
      '<li>🕹️ Includes DualSense wireless controller</li>',
      "<li>🎁 EA FC25 — the world's biggest football game</li>",
      '<li>🕷️ Spider-Man 2 — an epic open-world superhero adventure</li>',
      '<li>⚔️ God of War Ragnarök — critically acclaimed action RPG</li>',
      '</ul>',
      '<p><em>Brand new, sealed. Console and games in original packaging.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Sony PlayStation 5 Slim console (sealed)</li>',
      '<li>1× DualSense wireless controller</li>',
      '<li>3× Game discs: EA FC25 + Spider-Man 2 + God of War Ragnarök</li>',
      '<li>HDMI cable, USB-C cable, and AC power cord</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱150 per share</li>',
      '<li>Once all 200 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 20 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  // ─────────────────────────────────────────
  // Home Appliances
  // ─────────────────────────────────────────
  {
    treasureSeq: 'JM-004',
    treasureName: 'Dyson V15 Detect Absolute Vacuum',
    productName: 'Dyson V15 Detect Absolute Cordless Vacuum Cleaner',
    treasureCoverImg:
      'https://cdn.joyminis.com/images/treasure/dysonv15-cover.jpg',
    mainImageList: [
      'https://cdn.joyminis.com/images/treasure/dysonv15-1.jpg',
      'https://cdn.joyminis.com/images/treasure/dysonv15-2.jpg',
    ],
    unitAmount: 100,
    marketAmount: 15000,
    costAmount: 13500,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 52,
    ...G3,
    desc: [
      '<img src="https://cdn.joyminis.com/images/treasure/dysonv15-1.jpg" alt="Dyson V15 Detect Vacuum" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Dyson V15 Detect Absolute Cordless Vacuum</h3>',
      "<p>Dyson's most powerful cordless vacuum ever. The V15 Detect uses a built-in green laser to reveal invisible dust on hard floors — so you know exactly what you're cleaning up. Powered by Dyson's Hyperdymium motor spinning at 125,000 RPM.</p>",
      '<p>The whole-machine HEPA filtration captures 99.99% of particles as small as 0.3 microns, expelling cleaner air than you breathe in. Perfect for allergy sufferers and households with pets.</p>',
      '<ul>',
      '<li>🔦 Laser dust detection — reveals fine dust invisible to the naked eye</li>',
      '<li>💨 230 AW powerful suction in boost mode</li>',
      '<li>🌿 HEPA filtration — captures 99.99% of particles ≥0.3 microns</li>',
      '<li>🔋 Up to 60 minutes runtime on a single charge</li>',
      '<li>📊 LCD screen shows remaining runtime and suction mode</li>',
      '<li>🏠 Converts to handheld for stairs, car, and upholstery</li>',
      '<li>🐾 Anti-tangle hair screw tool — no more hair wrap</li>',
      '</ul>',
      '<p><em>Brand new in original Dyson retail box with full accessories.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Dyson V15 Detect Absolute cordless vacuum</li>',
      '<li>Laser Slim Fluffy cleaner head</li>',
      '<li>Hair screw tool, crevice tool, and combination tool</li>',
      '<li>Dyson docking station and charger</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱100 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Home',
  },
  // ─────────────────────────────────────────
  // Fashion & Lifestyle
  // ─────────────────────────────────────────
  {
    treasureSeq: 'JM-005',
    treasureName: 'Nike Air Jordan 4 Retro "Military Blue" (US10)',
    productName: 'Air Jordan 4 Retro Military Blue US Size 10',
    treasureCoverImg: 'https://cdn.joyminis.com/images/treasure/aj4-cover.jpg',
    mainImageList: [
      'https://cdn.joyminis.com/product/images/aj4-1.jpg',
      'https://cdn.joyminis.com/product/images/aj4-2.jpg',
    ],
    unitAmount: 50,
    marketAmount: 5000,
    costAmount: 4500,
    seqShelvesQuantity: 100,
    minBuyQuantity: 100,
    maxPerBuyQuantity: 10,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 37,
    ...G5,
    desc: [
      '<img src="https://cdn.joyminis.com/product/images/aj4-1.jpg" alt="Air Jordan 4 Military Blue side view" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://cdn.joyminis.com/product/images/aj4-2.jpg" alt="Air Jordan 4 Military Blue sole" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Nike Air Jordan 4 Retro "Military Blue" — US Size 10</h3>',
      '<p>One of the most iconic Jordan colorways of all time. The Military Blue Air Jordan 4 first debuted in 1989 and has remained a grail sneaker ever since. This retro release stays true to the original with premium details and the signature Jumpman branding.</p>',
      "<p>Authentic, brand new, and delivered in the original Nike box. A true collector's piece and a statement in any outfit.</p>",
      '<ul>',
      '<li>👟 Nike Air Jordan 4 Retro — authentic, brand new in original box</li>',
      '<li>🎨 Military Blue colorway — classic white/military blue/neutral grey</li>',
      '<li>💨 Nike Air cushioning in the heel for all-day comfort</li>',
      '<li>🔒 Lace-lock system with mesh side panels for breathability</li>',
      '<li>📏 US Size 10 (fits true to size)</li>',
      '<li> Comes with original box, extra laces, and hang tags</li>',
      '</ul>',
      '<p><em>100% authentic. Ships in original Nike retail box. Certificate of authenticity included.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Nike Air Jordan 4 Retro Military Blue (US10)</li>',
      '<li>Original Nike retail box and tissue paper</li>',
      '<li>Extra replacement lace set</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱50 per share</li>',
      '<li>Once all 100 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 10 shares per user. Size US10 only — non-exchangeable. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Fashion',
  },
  // ─────────────────────────────────────────
  // Beauty & Health
  // ─────────────────────────────────────────
  {
    treasureSeq: 'JM-006',
    treasureName: 'Dyson Supersonic HD15 Hair Dryer',
    productName: 'Dyson Supersonic HD15 Nickel/Copper',
    treasureCoverImg:
      'https://cdn.joyminis.com/product/images/dysonsupersonic-cover.jpg',
    mainImageList: [
      'https://cdn.joyminis.com/images/treasure/dysonsupersonic-1.jpg',
    ],
    unitAmount: 80,
    marketAmount: 10000,
    costAmount: 9000,
    seqShelvesQuantity: 125,
    minBuyQuantity: 125,
    maxPerBuyQuantity: 10,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 43,
    ...G3,
    desc: [
      '<img src="https://cdn.joyminis.com/images/treasure/dysonsupersonic-1.jpg" alt="Dyson Supersonic HD15" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Dyson Supersonic HD15 Hair Dryer — Nickel/Copper</h3>',
      '<p>The Dyson Supersonic HD15 redefines hair drying. Its intelligent heat control system measures air temperature over 40 times per second, ensuring your hair is never exposed to extreme heat damage. The result: faster drying with visibly healthier hair.</p>',
      '<p>Ultra-light at just 641g with a perfectly balanced design, it reduces arm fatigue even during long styling sessions.</p>',
      '<ul>',
      '<li>🌡️ Intelligent heat control — measures temperature 40× per second</li>',
      '<li>💨 13-blade brushless motor for fast, powerful airflow</li>',
      '<li>✨ Ionic conditioning for smooth, frizz-free finish</li>',
      '<li>⚖️ 641g ultra-light body — reduces arm fatigue</li>',
      '<li>🔇 Acoustically tuned for quieter operation</li>',
      '<li>🎛️ 3 speed settings + 4 heat settings for all hair types</li>',
      '<li>🧲 Magnetic attachments: smoothing nozzle + diffuser + flyaway attachment</li>',
      '</ul>',
      '<p><em>Brand new in original Dyson retail box with full attachment set.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Dyson Supersonic HD15 hair dryer (Nickel/Copper)</li>',
      '<li>Smoothing nozzle, diffuser, and flyaway attachment</li>',
      '<li>Presentation case and original Dyson retail box</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱80 per share</li>',
      '<li>Once all 125 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 10 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Beauty',
  },
  // ─────────────────────────────────────────
  // Popular Mid-range Picks
  // ─────────────────────────────────────────
  {
    treasureSeq: 'JM-007',
    treasureName: 'Xiaomi Smart Air Fryer 6L',
    productName: 'Xiaomi Smart Air Fryer 6L with App Control',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-007-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-007-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-007-2.jpg',
    ],
    unitAmount: 100,
    marketAmount: 5000,
    costAmount: 4200,
    seqShelvesQuantity: 60,
    minBuyQuantity: 60,
    maxPerBuyQuantity: 10,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 21,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-007-1.jpg" alt="Xiaomi Smart Air Fryer 6L" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Xiaomi Smart Air Fryer 6L</h3>',
      '<p>Healthy cooking gets easier with this 6L smart air fryer. It supports low-oil frying, baking, roasting, and dehydration with app control and preset programs for everyday meals.</p>',
      '<p>Great for families and meal prep users who want faster cooking with less cleanup. The larger basket size helps you cook more servings at once.</p>',
      '<ul>',
      '<li>🍗 6L large capacity for 3-6 servings</li>',
      '<li>📱 Smart app control with remote scheduling</li>',
      '<li>🔥 40-200 C wide temperature range</li>',
      '<li>⏱️ Built-in presets for chicken, fries, seafood, and desserts</li>',
      '<li>🧼 Non-stick basket for quick cleanup</li>',
      '</ul>',
      '<p><em>Brand new physical product. Shipment arranged after winner address confirmation.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Xiaomi Smart Air Fryer 6L</li>',
      '<li>Power cable and user manual</li>',
      '<li>Original retail packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱100 per share</li>',
      '<li>Once all 60 shares are sold, one winner is randomly selected</li>',
      '<li>Winner is announced within 24 hours and contacted via registered account</li>',
      "<li>Prize is shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 10 shares per user. All purchases are final. Metro Manila delivery 3-5 business days; provincial 5-7 business days.</p>',
    ].join(''),
    category: 'Home',
  },
  {
    treasureSeq: 'JM-008',
    treasureName: 'Nintendo Switch OLED + Mario Kart 8 Bundle',
    productName: 'Nintendo Switch OLED White with Mario Kart 8 Deluxe',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-008-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-008-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-008-2.jpg',
    ],
    unitAmount: 200,
    marketAmount: 10000,
    costAmount: 8500,
    seqShelvesQuantity: 60,
    minBuyQuantity: 60,
    maxPerBuyQuantity: 10,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 18,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-008-1.jpg" alt="Nintendo Switch OLED Bundle" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Nintendo Switch OLED + Mario Kart 8 Bundle</h3>',
      '<p>Enjoy premium portable gaming with the Nintendo Switch OLED model. The vibrant 7-inch OLED screen, improved kickstand, and enhanced audio make every game session better at home or on the go.</p>',
      '<p>This bundle includes Mario Kart 8 Deluxe, one of the most popular party and family games, perfect for solo play or multiplayer fun.</p>',
      '<ul>',
      '<li>🎮 7-inch OLED display with vivid colors</li>',
      '<li>🕹️ Includes Joy-Con pair and dock for TV mode</li>',
      '<li>🏁 Includes Mario Kart 8 Deluxe game copy</li>',
      '<li>🔋 Portable play with long battery life</li>',
      '<li>👨‍👩‍👧‍👦 Great for family and group entertainment</li>',
      '</ul>',
      '<p><em>Brand new physical product. Shipment arranged after winner address confirmation.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Nintendo Switch OLED console (White)</li>',
      '<li>Joy-Con controllers, dock, power adapter, HDMI cable</li>',
      '<li>1× Mario Kart 8 Deluxe game copy</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱200 per share</li>',
      '<li>Once all 60 shares are sold, one winner is randomly selected</li>',
      '<li>Winner is announced within 24 hours and contacted via registered account</li>',
      "<li>Prize is shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 10 shares per user. All purchases are final. Metro Manila delivery 3-5 business days; provincial 5-7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  {
    treasureSeq: 'JM-009',
    treasureName: 'Android Tablet 10.1-inch 8GB+128GB',
    productName: '10.1-inch Android Tablet, 8GB RAM, 128GB Storage, Wi-Fi',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-009-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-009-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-009-2.jpg',
    ],
    unitAmount: 60,
    marketAmount: 12999,
    costAmount: 10800,
    seqShelvesQuantity: 180,
    minBuyQuantity: 180,
    maxPerBuyQuantity: 18,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 95,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-009-1.jpg" alt="Android Tablet 10.1 inch front" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-009-2.jpg" alt="Android Tablet in use" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-009-3.jpg" alt="Android Tablet accessories" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Android Tablet 10.1-inch 8GB+128GB</h3>',
      '<p>Big-screen entertainment and smooth multitasking for study, movies, work, and casual gaming. Powered by an octa-core processor with 8GB RAM, this tablet handles daily tasks with ease while the large 10.1-inch display brings everything to life.</p>',
      "<p>With 128GB of internal storage and expandable memory support, you'll never run out of space for apps, photos, and videos.</p>",
      '<ul>',
      '<li>📱 10.1-inch HD display with eye comfort mode</li>',
      '<li>⚡ Octa-core processor for smooth multitasking</li>',
      '<li>💾 8GB RAM + 128GB storage (expandable via microSD)</li>',
      '<li>🔋 6000mAh large battery for all-day use</li>',
      '<li>🔊 Dual speakers for immersive audio</li>',
      '<li>📸 Rear and front cameras for video calls and photos</li>',
      '<li>📶 Wi-Fi + Bluetooth 5.0 connectivity</li>',
      '</ul>',
      '<p><em>Brand new with standard accessories. Perfect for students, remote workers, and daily entertainment.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× 10.1-inch Android Tablet (8GB+128GB)</li>',
      '<li>USB-C charging cable and adapter</li>',
      '<li>Original retail packaging with user manual</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱60 per share</li>',
      '<li>Once all 180 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 18 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  {
    treasureSeq: 'JM-010',
    treasureName: 'Robot Vacuum & Mop 3-in-1 Smart Cleaner',
    productName: '3-in-1 Robot Vacuum Cleaner with Mopping Function',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-010-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-010-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-010-2.jpg',
    ],
    unitAmount: 70,
    marketAmount: 14999,
    costAmount: 12800,
    seqShelvesQuantity: 160,
    minBuyQuantity: 160,
    maxPerBuyQuantity: 16,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 78,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-010-1.jpg" alt="Robot Vacuum on floor" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-010-2.jpg" alt="Robot Vacuum mopping" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Robot Vacuum & Mop 3-in-1 Smart Cleaner</h3>',
      '<p>Let your floors stay clean while you focus on what matters. This smart robot handles vacuuming, sweeping, and mopping in a single pass — automatically navigating your home with intelligent path planning.</p>',
      '<p>Quiet enough to run while you sleep or work, it returns to its docking station automatically when done or when the battery runs low.</p>',
      '<ul>',
      '<li>🤖 3-in-1: vacuum + sweep + mop in one device</li>',
      '<li>🗺️ Smart path planning for efficient full-room coverage</li>',
      '<li>🔇 Low-noise operation mode — runs day or night</li>',
      '<li>🔋 Auto-return to dock when battery is low</li>',
      '<li>🧹 Strong suction for pet hair, dust, and debris</li>',
      '<li>💧 Water tank for simultaneous mopping function</li>',
      '<li>📱 App control and scheduling (model-specific)</li>',
      '</ul>',
      '<p><em>Brand new with charger and standard accessories. Color and model may vary based on supplier stock.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× 3-in-1 Robot Vacuum & Mop</li>',
      '<li>Docking station and power adapter</li>',
      '<li>Water tank and mop attachment</li>',
      '<li>Replacement filter set and cleaning brush</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱70 per share</li>',
      '<li>Once all 160 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 16 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Home',
  },
  {
    treasureSeq: 'JM-011',
    treasureName: 'Digital Air Fryer 5L Oil-Less Cooker',
    productName: '5L Touchscreen Air Fryer with 8 Preset Modes',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-011-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-011-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-011-2.jpg',
    ],
    unitAmount: 40,
    marketAmount: 6999,
    costAmount: 5600,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 86,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-011-1.jpg" alt="Air Fryer 5L front" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-011-2.jpg" alt="Air Fryer cooking chicken" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-011-3.jpg" alt="Air Fryer touch panel" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Digital Air Fryer 5L Oil-Less Cooker</h3>',
      '<p>Get crispy, golden results with up to 80% less oil than traditional frying. The 5L capacity is perfect for families — cook fries, chicken, fish, or desserts in minutes with the intuitive digital touch panel.</p>',
      '<p>Eight smart presets take the guesswork out of cooking. Just press and go — the air fryer handles the rest while you do something better with your time.</p>',
      '<ul>',
      '<li>🍗 Up to 80% less oil than traditional frying — healthier meals</li>',
      '<li>📱 Digital touchscreen with 8 one-touch cooking presets</li>',
      '<li>🪣 5L basket — ideal for 2–4 servings</li>',
      '<li>🌡️ Temperature range 80°C–200°C for versatile cooking</li>',
      '<li>⏱️ 30-minute timer with auto shut-off</li>',
      '<li>🧹 Removable non-stick basket — dishwasher safe</li>',
      '<li>🔇 Quiet operation compared to traditional ovens</li>',
      '</ul>',
      '<p><em>Brand new with user manual and standard accessories.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Digital Air Fryer 5L with touchscreen panel</li>',
      '<li>Removable non-stick fry basket</li>',
      '<li>User manual with recipe guide</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱40 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Home',
  },
  {
    treasureSeq: 'JM-012',
    treasureName: 'IP68 Fitness Smart Watch 100+ Sports Modes',
    productName: 'Waterproof Smartwatch with Heart Rate and Sleep Tracking',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-012-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-012-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-012-2.jpg',
    ],
    unitAmount: 35,
    marketAmount: 4999,
    costAmount: 3800,
    seqShelvesQuantity: 140,
    minBuyQuantity: 140,
    maxPerBuyQuantity: 14,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 102,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-012-1.jpg" alt="Smart Watch on wrist" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-012-2.jpg" alt="Smart Watch health tracking" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>IP68 Fitness Smart Watch — 100+ Sports Modes</h3>',
      '<p>Take control of your health and fitness with a smartwatch designed for active daily life. Real-time heart rate monitoring, comprehensive sleep tracking, and blood oxygen measurement give you a complete picture of your wellbeing throughout the day.</p>',
      "<p>With 100+ dedicated sports modes, it automatically detects your workout and tracks the right metrics whether you're running, cycling, swimming, or hitting the gym.</p>",
      '<ul>',
      '<li>❤️ 24/7 heart rate monitoring with high/low alerts</li>',
      '<li>😴 Sleep tracking — deep, light, and REM cycle analysis</li>',
      '<li>🩸 Blood oxygen (SpO2) level monitoring</li>',
      '<li>🏃 100+ sports modes — auto-detects workout type</li>',
      '<li>💧 IP68 waterproof — safe for swimming and heavy rain</li>',
      '<li>🔋 Up to 7 days battery life on a single charge</li>',
      '<li>📱 Notifications for calls, SMS, and apps</li>',
      '<li>🌤️ Built-in weather forecast display</li>',
      '</ul>',
      '<p><em>Brand new with charging cable and extra strap set.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× IP68 Fitness Smartwatch</li>',
      '<li>Magnetic charging cable</li>',
      '<li>Extra silicone replacement strap</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱35 per share</li>',
      '<li>Once all 140 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 14 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Sports',
  },
  {
    treasureSeq: 'JM-013',
    treasureName: 'Women Minimalist Crossbody Bag Set',
    productName: 'PU Leather Crossbody Shoulder Bag with Multi-Compartment',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-013-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-013-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-013-2.jpg',
    ],
    unitAmount: 25,
    marketAmount: 2999,
    costAmount: 2100,
    seqShelvesQuantity: 120,
    minBuyQuantity: 120,
    maxPerBuyQuantity: 12,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 73,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-013-1.jpg" alt="Crossbody Bag front" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-013-2.jpg" alt="Crossbody Bag interior compartments" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Women Minimalist Crossbody Bag Set</h3>',
      '<p>Elegant, practical, and easy to match with any outfit. This minimalist crossbody bag combines premium-look PU leather with thoughtful interior organization — everything you need, always at your fingertips.</p>',
      '<p>Lightweight enough to carry all day, with enough room for your phone, cards, keys, and small essentials. Perfect for work commutes, weekend outings, and evening events.</p>',
      '<ul>',
      '<li>👜 Soft PU leather exterior — premium texture, lightweight body</li>',
      '<li>🗂️ Multi-compartment interior with card slots and zippered pocket</li>',
      '<li>📐 Compact dimensions — holds phone, wallet, keys, and lip care</li>',
      '<li>🎗️ Adjustable crossbody strap — fits all heights comfortably</li>',
      '<li>🔒 Magnetic snap closure for secure, easy access</li>',
      '<li>🎨 Neutral color palette — matches casual, smart-casual, and formal looks</li>',
      '</ul>',
      '<p><em>Brand new. Color and style may vary slightly based on supplier batch.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      "<li>1× Women's Minimalist Crossbody Bag</li>",
      '<li>Adjustable shoulder strap</li>',
      '<li>Dust bag for storage</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱25 per share</li>',
      '<li>Once all 120 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 12 shares per user. Color variant based on available stock. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Fashion',
  },
  {
    treasureSeq: 'JM-014',
    treasureName: 'Adjustable Dumbbell Set for Home Gym',
    productName: 'Multi-Weight Dumbbell Kit with Anti-Slip Grip',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-014-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-014-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-014-2.jpg',
    ],
    unitAmount: 45,
    marketAmount: 7999,
    costAmount: 6500,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 68,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-014-1.jpg" alt="Adjustable Dumbbell Set" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-014-2.jpg" alt="Dumbbell in use workout" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Adjustable Dumbbell Set for Home Gym</h3>',
      '<p>Build strength, tone your body, and stay fit without leaving home. This adjustable dumbbell kit replaces an entire rack of weights in one compact design — perfect for apartments and home workout spaces.</p>',
      '<p>Anti-slip rubber grip handles keep your hands secure during intense sets, while the quick-adjust weight system lets you switch between exercises with minimal interruption.</p>',
      '<ul>',
      '<li>🏋️ Adjustable weight levels — one set replaces multiple dumbbells</li>',
      '<li>✋ Anti-slip rubberized grip handle for safe lifting</li>',
      '<li>⚡ Quick-lock weight adjustment — swap weights in seconds</li>',
      '<li>🏠 Compact footprint — ideal for home gym and small spaces</li>',
      '<li>💪 Suitable for bicep curls, shoulder press, rows, and more</li>',
      '<li>🛡️ Durable chrome and rubber construction</li>',
      '</ul>',
      '<p><em>Brand new in retail packaging. Weight range based on supplier configuration.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Adjustable Dumbbell Set (pair)</li>',
      '<li>Weight plate components and locking mechanism</li>',
      '<li>Storage tray or carry bag (where included)</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱45 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. Weight configuration based on available supplier stock. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Sports',
  },
  {
    treasureSeq: 'JM-015',
    treasureName: 'Mini Portable Projector 1080P Support',
    productName: 'Pocket Projector with WiFi Screen Mirroring',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-015-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-015-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-015-2.jpg',
    ],
    unitAmount: 55,
    marketAmount: 9999,
    costAmount: 8400,
    seqShelvesQuantity: 160,
    minBuyQuantity: 160,
    maxPerBuyQuantity: 16,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 89,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-015-1.jpg" alt="Mini Projector projecting movie" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<img src="https://img.joyminis.com/images/treasure/jm-015-2.jpg" alt="Mini Projector compact size" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Mini Portable Projector — 1080P Support</h3>',
      '<p>Turn any blank wall or ceiling into a private cinema. This pocket-sized projector supports 1080P Full HD playback and wireless screen mirroring from your phone, tablet, or laptop — no cables needed for most setups.</p>',
      '<p>Perfect for movie nights at home, outdoor movie setups, travel entertainment, or compact presentations. Set it up in seconds and enjoy a big-screen experience anywhere.</p>',
      '<ul>',
      '<li>🎬 1080P Full HD support — crisp, clear projection up to 120 inches</li>',
      '<li>📶 WiFi screen mirroring from iOS and Android devices</li>',
      '<li>🔌 HDMI + USB ports for direct connection</li>',
      '<li>🔊 Built-in dual speakers — no external speaker needed</li>',
      '<li>🌙 Best viewed in dark or dim environments</li>',
      '<li>📦 Pocket-sized and lightweight — takes anywhere</li>',
      '<li>🔋 Built-in battery option for cordless outdoor use (model-specific)</li>',
      '</ul>',
      '<p><em>Brand new with power adapter and standard accessories. Model and color based on supplier stock.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Mini Portable Projector (1080P Support)</li>',
      '<li>Power adapter and HDMI cable</li>',
      '<li>Remote control (where included by supplier)</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱55 per share</li>',
      '<li>Once all 160 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 16 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  // ─────────────────────────────────────────
  // Additional Assortment
  // ─────────────────────────────────────────
  {
    treasureSeq: 'JM-016',
    treasureName: 'Anker MagGo 10,000mAh Magnetic Power Bank',
    productName: 'Anker MagGo Power Bank 10,000mAh USB-C Fast Charge',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-016-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-016-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-016-2.jpg',
    ],
    unitAmount: 30,
    marketAmount: 3999,
    costAmount: 3200,
    seqShelvesQuantity: 140,
    minBuyQuantity: 140,
    maxPerBuyQuantity: 14,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 76,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-016-1.jpg" alt="Anker MagGo power bank" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Anker MagGo 10,000mAh Magnetic Power Bank</h3>',
      '<p>Keep your devices powered all day with a compact magnetic power bank designed for fast wireless and USB-C charging. Ideal for daily commuting, travel, and emergency backup.</p>',
      '<ul>',
      '<li>🔋 10,000mAh battery capacity for multiple top-ups</li>',
      '<li>🧲 Magnetic snap-on charging for compatible phones</li>',
      '<li>⚡ USB-C fast charging input and output</li>',
      '<li>🎒 Slim design that fits easily in bags and pockets</li>',
      '</ul>',
      '<p><em>Brand new with charging cable and retail packaging.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Anker MagGo 10,000mAh power bank</li>',
      '<li>USB-C charging cable</li>',
      '<li>Quick-start guide and retail box</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱30 per share</li>',
      '<li>Once all 140 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 14 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  {
    treasureSeq: 'JM-017',
    treasureName: 'Nespresso Essenza Mini Coffee Bundle',
    productName: "De'Longhi Nespresso Essenza Mini with Capsule Starter Pack",
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-017-cover.jpg',
    mainImageList: ['https://img.joyminis.com/images/treasure/jm-017-1.jpg'],
    unitAmount: 65,
    marketAmount: 8999,
    costAmount: 7600,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 48,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-017-1.jpg" alt="Nespresso Essenza Mini" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Nespresso Essenza Mini Coffee Bundle</h3>',
      '<p>Brew café-style espresso at home with a compact capsule machine that heats up fast and fits neatly on any kitchen counter.</p>',
      '<ul>',
      '<li>☕ One-touch espresso and lungo brewing</li>',
      '<li>⚡ Fast heat-up for busy mornings</li>',
      '<li>🏠 Compact footprint perfect for condos and apartments</li>',
      '<li>🎁 Includes starter capsule assortment</li>',
      '</ul>',
      '<p><em>Brand new with standard accessories and starter capsules.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Nespresso Essenza Mini machine</li>',
      '<li>Starter pack of coffee capsules</li>',
      '<li>User manual and retail packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱65 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Home',
  },
  {
    treasureSeq: 'JM-018',
    treasureName: 'Samsonite 20-inch Cabin Luggage',
    productName: 'Samsonite 20-inch Hard Shell Cabin Spinner',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-018-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-018-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-018-2.jpg',
    ],
    unitAmount: 55,
    marketAmount: 7999,
    costAmount: 6500,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 57,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-018-1.jpg" alt="Samsonite cabin luggage" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Samsonite 20-inch Cabin Luggage</h3>',
      '<p>Travel lighter and smarter with a durable carry-on suitcase designed for weekend trips, business travel, and cabin-friendly convenience.</p>',
      '<ul>',
      '<li>🧳 Hard-shell protection with modern lightweight build</li>',
      '<li>🛞 Smooth 360° spinner wheels</li>',
      '<li>🔒 Built-in TSA-style lock</li>',
      '<li>✈️ Cabin-friendly size for most airlines</li>',
      '</ul>',
      '<p><em>Brand new. Color may vary based on available stock.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Samsonite 20-inch cabin spinner luggage</li>',
      '<li>Built-in lock and interior organizer set</li>',
      '<li>Brand packaging and care tag</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱55 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. Color variant depends on supplier stock. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Lifestyle',
  },
  {
    treasureSeq: 'JM-019',
    treasureName: 'JBL Flip 7 Portable Bluetooth Speaker',
    productName: 'JBL Flip 7 Waterproof Portable Bluetooth Speaker',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-019-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-019-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-019-2.jpg',
    ],
    unitAmount: 45,
    marketAmount: 6999,
    costAmount: 5600,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 63,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-019-1.jpg" alt="JBL Flip 7 speaker" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>JBL Flip 7 Portable Bluetooth Speaker</h3>',
      '<p>Bring powerful sound anywhere with a waterproof Bluetooth speaker built for travel, parties, and everyday listening.</p>',
      '<ul>',
      '<li>🔊 Signature JBL bass and clear vocals</li>',
      '<li>💧 Waterproof and outdoor-ready design</li>',
      '<li>🔋 Long battery life for all-day playback</li>',
      '<li>📶 Fast Bluetooth pairing with phones and tablets</li>',
      '</ul>',
      '<p><em>Brand new with charging cable and retail packaging.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× JBL Flip 7 portable speaker</li>',
      '<li>USB-C charging cable</li>',
      '<li>Retail box and quick-start guide</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱45 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Electronics',
  },
  {
    treasureSeq: 'JM-020',
    treasureName: 'New Balance 530 Running Sneakers (US8)',
    productName: 'New Balance 530 Lifestyle Running Shoes US Size 8',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-020-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-020-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-020-2.jpg',
    ],
    unitAmount: 50,
    marketAmount: 6500,
    costAmount: 5200,
    seqShelvesQuantity: 120,
    minBuyQuantity: 120,
    maxPerBuyQuantity: 12,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 58,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-020-1.jpg" alt="New Balance 530 sneakers" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>New Balance 530 Running Sneakers (US8)</h3>',
      '<p>A clean everyday sneaker that blends retro running style with comfort for commuting, errands, and casual outfits.</p>',
      '<ul>',
      '<li>👟 Lightweight cushioning for daily wear</li>',
      '<li>🎨 Easy-to-match neutral colorway</li>',
      '<li>🪶 Breathable mesh upper</li>',
      '<li>📏 US Size 8 only</li>',
      '</ul>',
      '<p><em>Brand new with original box. Size-specific prize.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Pair of New Balance 530 sneakers (US8)</li>',
      '<li>Original shoe box and tags</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱50 per share</li>',
      '<li>Once all 120 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 12 shares per user. Size US8 only and non-exchangeable. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Fashion',
  },
  {
    treasureSeq: 'JM-021',
    treasureName: 'Professional Makeup Vanity Gift Kit',
    productName: '18-Piece Makeup Vanity Gift Kit with Brush Set',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-021-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-021-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-021-2.jpg',
    ],
    unitAmount: 28,
    marketAmount: 3999,
    costAmount: 3000,
    seqShelvesQuantity: 140,
    minBuyQuantity: 140,
    maxPerBuyQuantity: 14,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 61,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-021-1.jpg" alt="Makeup vanity kit" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Professional Makeup Vanity Gift Kit</h3>',
      '<p>A complete beauty gift set for everyday glam, special occasions, and beginner-friendly makeup routines.</p>',
      '<ul>',
      '<li>💄 Multi-shade eye, cheek, and lip palette</li>',
      '<li>🖌️ Includes brush set and compact accessories</li>',
      '<li>🎁 Gift-ready presentation box</li>',
      '<li>✨ Great for travel and vanity organization</li>',
      '</ul>',
      '<p><em>Brand new sealed set. Shade assortment may vary slightly by batch.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× 18-piece makeup vanity kit</li>',
      '<li>Brush and applicator set</li>',
      '<li>Gift box packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱28 per share</li>',
      '<li>Once all 140 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 14 shares per user. Shade assortment may vary by supplier batch. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Beauty',
  },
  {
    treasureSeq: 'JM-022',
    treasureName: 'Deep Tissue Massage Gun Recovery Set',
    productName: 'Portable Deep Tissue Massage Gun with 6 Heads',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-022-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-022-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-022-2.jpg',
    ],
    unitAmount: 48,
    marketAmount: 6999,
    costAmount: 5600,
    seqShelvesQuantity: 140,
    minBuyQuantity: 140,
    maxPerBuyQuantity: 14,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 69,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-022-1.jpg" alt="Massage gun recovery set" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Deep Tissue Massage Gun Recovery Set</h3>',
      '<p>Recover faster after workouts with a powerful massage gun designed to relieve muscle tension, stiffness, and soreness at home or in the gym.</p>',
      '<ul>',
      '<li>💪 Deep tissue percussion therapy</li>',
      '<li>🔄 Multiple speed levels for recovery and warm-up</li>',
      '<li>🎒 Carry case included for travel and storage</li>',
      '<li>🔋 Rechargeable cordless operation</li>',
      '</ul>',
      '<p><em>Brand new set with interchangeable massage heads.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Deep tissue massage gun</li>',
      '<li>6× Interchangeable massage heads</li>',
      '<li>Carry case and charging cable</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱48 per share</li>',
      '<li>Once all 140 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 14 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Sports',
  },
  {
    treasureSeq: 'JM-023',
    treasureName: 'Tefal Non-Stick Cookware 10-Piece Set',
    productName: 'Tefal 10-Piece Non-Stick Pots and Pans Set',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-023-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-023-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-023-2.jpg',
    ],
    unitAmount: 42,
    marketAmount: 5999,
    costAmount: 4700,
    seqShelvesQuantity: 160,
    minBuyQuantity: 160,
    maxPerBuyQuantity: 16,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 82,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-023-1.jpg" alt="Tefal cookware set" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Tefal Non-Stick Cookware 10-Piece Set</h3>',
      '<p>Upgrade your kitchen with a versatile cookware set built for everyday frying, sautéing, and simmering with easier cleanup.</p>',
      '<ul>',
      '<li>🍳 Non-stick coating for low-oil cooking</li>',
      '<li>🍲 Multiple pot and pan sizes for daily meals</li>',
      '<li>🔥 Even heat distribution for reliable cooking</li>',
      '<li>🏠 Great starter set for families and new homes</li>',
      '</ul>',
      '<p><em>Brand new boxed cookware set.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× 10-piece Tefal cookware set</li>',
      '<li>Matching lids and cooking utensils (where included)</li>',
      '<li>Retail packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱42 per share</li>',
      '<li>Once all 160 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 16 shares per user. Set configuration may vary slightly by supplier batch. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Home',
  },
  {
    treasureSeq: 'JM-024',
    treasureName: 'Adidas Defender Gym Duffel Bundle',
    productName: 'Adidas Defender Duffel Bag with Sports Bottle Set',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-024-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-024-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-024-2.jpg',
    ],
    unitAmount: 30,
    marketAmount: 4299,
    costAmount: 3300,
    seqShelvesQuantity: 130,
    minBuyQuantity: 130,
    maxPerBuyQuantity: 13,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 74,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-024-1.jpg" alt="Adidas gym duffel" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Adidas Defender Gym Duffel Bundle</h3>',
      '<p>Carry your workout essentials in a dependable duffel bag bundle built for gym sessions, training days, and quick weekend trips.</p>',
      '<ul>',
      '<li>🎒 Spacious main compartment for shoes and gear</li>',
      '<li>💧 Includes sports bottle bundle</li>',
      '<li>🏋️ Durable material for everyday use</li>',
      '<li>🧳 Easy-carry handles and adjustable strap</li>',
      '</ul>',
      '<p><em>Brand new sports bundle. Color may vary based on stock.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Adidas Defender duffel bag</li>',
      '<li>1× Sports bottle or shaker set</li>',
      '<li>Brand packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱30 per share</li>',
      '<li>Once all 130 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 13 shares per user. Color variant depends on supplier stock. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Sports',
  },
  {
    treasureSeq: 'JM-025',
    treasureName: "L'Oréal Revitalift Skincare Gift Box",
    productName: "L'Oréal Paris Revitalift Day and Night Skincare Set",
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-025-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-025-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-025-2.jpg',
    ],
    unitAmount: 26,
    marketAmount: 3599,
    costAmount: 2800,
    seqShelvesQuantity: 120,
    minBuyQuantity: 120,
    maxPerBuyQuantity: 12,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 71,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-025-1.jpg" alt="L\'Oréal skincare set" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      "<h3>L'Oréal Revitalift Skincare Gift Box</h3>",
      '<p>A practical skincare gift set that supports hydration, smoother texture, and everyday anti-aging care for morning and night routines.</p>',
      '<ul>',
      '<li>🧴 Includes day cream, night cream, and serum essentials</li>',
      '<li>✨ Designed for smoother, firmer-looking skin</li>',
      '<li>🎁 Gift-ready packaging for personal use or gifting</li>',
      '<li>🌙 Day-and-night routine in one set</li>',
      '</ul>',
      '<p><em>Brand new sealed skincare set.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      "<li>1× L'Oréal Revitalift skincare gift set</li>",
      '<li>Day and night routine products</li>',
      '<li>Gift box packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱26 per share</li>',
      '<li>Once all 120 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 12 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Beauty',
  },
  {
    treasureSeq: 'JM-026',
    treasureName: 'Fossil Fiona Leather Satchel',
    productName: 'Fossil Fiona Leather Satchel Handbag',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-026-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-026-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-026-2.jpg',
    ],
    unitAmount: 38,
    marketAmount: 5499,
    costAmount: 4300,
    seqShelvesQuantity: 130,
    minBuyQuantity: 130,
    maxPerBuyQuantity: 13,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 66,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-026-1.jpg" alt="Fossil satchel handbag" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Fossil Fiona Leather Satchel</h3>',
      '<p>A stylish everyday handbag with structured storage, timeless design, and just the right space for essentials from day to night.</p>',
      '<ul>',
      '<li>👜 Premium-look leather finish</li>',
      '<li>🗂️ Multiple compartments for organized carry</li>',
      '<li>🎗️ Top handles and adjustable strap</li>',
      '<li>✨ Versatile style for work and casual wear</li>',
      '</ul>',
      '<p><em>Brand new handbag. Color may vary based on supplier stock.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Fossil Fiona leather satchel</li>',
      '<li>Adjustable shoulder strap</li>',
      '<li>Dust bag and tag set</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱38 per share</li>',
      '<li>Once all 130 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 13 shares per user. Color variant depends on supplier stock. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Fashion',
  },
  {
    treasureSeq: 'JM-027',
    treasureName: 'American Tourister 24-inch Travel Luggage',
    productName: 'American Tourister 24-inch Mid-Size Spinner Luggage',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-027-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-027-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-027-2.jpg',
    ],
    unitAmount: 52,
    marketAmount: 7499,
    costAmount: 6100,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 53,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-027-1.jpg" alt="American Tourister luggage" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>American Tourister 24-inch Travel Luggage</h3>',
      '<p>A practical mid-size suitcase for longer trips with durable construction, easy rolling wheels, and roomy packing space.</p>',
      '<ul>',
      '<li>🧳 Mid-size travel luggage for check-in trips</li>',
      '<li>🛞 Smooth spinner wheels for easier movement</li>',
      '<li>🔒 Secure zipper and built-in lock design</li>',
      '<li>📦 Spacious interior with compression straps</li>',
      '</ul>',
      '<p><em>Brand new. Color may vary based on supplier stock.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× American Tourister 24-inch luggage</li>',
      '<li>Interior organizer and brand tags</li>',
      '<li>Retail packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱52 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. Color variant depends on supplier stock. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Lifestyle',
  },
  {
    treasureSeq: 'JM-028',
    treasureName: 'Xiaomi Smart Band 9 + Earbuds Combo',
    productName: 'Xiaomi Smart Band 9 with Wireless Earbuds Bundle',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-028-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-028-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-028-2.jpg',
    ],
    unitAmount: 32,
    marketAmount: 4599,
    costAmount: 3600,
    seqShelvesQuantity: 140,
    minBuyQuantity: 140,
    maxPerBuyQuantity: 14,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 79,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-028-1.jpg" alt="Xiaomi smart band bundle" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Xiaomi Smart Band 9 + Earbuds Combo</h3>',
      '<p>A fitness-friendly wearable bundle that helps you track steps, workouts, and notifications while staying connected with wireless audio.</p>',
      '<ul>',
      '<li>⌚ Fitness band with activity and sleep tracking</li>',
      '<li>🎧 Wireless earbuds for workouts and commuting</li>',
      '<li>🔋 Long battery life for daily use</li>',
      '<li>📱 Smart notifications and app sync</li>',
      '</ul>',
      '<p><em>Brand new bundle with charging accessories.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Xiaomi Smart Band 9</li>',
      '<li>1× Wireless earbuds pair with charging case</li>',
      '<li>Charging cable and quick-start guide</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱32 per share</li>',
      '<li>Once all 140 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 14 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Sports',
  },
  {
    treasureSeq: 'JM-029',
    treasureName: 'Sonic Electric Toothbrush Duo Set',
    productName: 'Philips Sonic Electric Toothbrush Duo with Spare Heads',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-029-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-029-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-029-2.jpg',
    ],
    unitAmount: 34,
    marketAmount: 4999,
    costAmount: 3800,
    seqShelvesQuantity: 130,
    minBuyQuantity: 130,
    maxPerBuyQuantity: 13,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 62,
    ...G5,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-029-1.jpg" alt="Electric toothbrush duo" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Sonic Electric Toothbrush Duo Set</h3>',
      '<p>Level up your daily routine with a sonic toothbrush pair designed for cleaner brushing, gentler gum care, and convenient charging.</p>',
      '<ul>',
      '<li>🪥 Dual-handle set perfect for couples or family use</li>',
      '<li>✨ Sonic cleaning action for deeper plaque removal</li>',
      '<li>🔋 Rechargeable base with long-lasting battery</li>',
      '<li>🧼 Includes spare brush heads</li>',
      '</ul>',
      '<p><em>Brand new hygiene care set in sealed packaging.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>2× Sonic electric toothbrush handles</li>',
      '<li>Spare brush heads and charger base</li>',
      '<li>Retail packaging</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱34 per share</li>',
      '<li>Once all 130 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 13 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Beauty',
  },
  {
    treasureSeq: 'JM-030',
    treasureName: 'Kindle Paperwhite 11th Gen',
    productName: 'Amazon Kindle Paperwhite 11th Generation 16GB',
    treasureCoverImg:
      'https://img.joyminis.com/images/treasure/jm-030-cover.jpg',
    mainImageList: [
      'https://img.joyminis.com/images/treasure/jm-030-1.jpg',
      'https://img.joyminis.com/images/treasure/jm-030-2.jpg',
    ],
    unitAmount: 58,
    marketAmount: 8499,
    costAmount: 7000,
    seqShelvesQuantity: 150,
    minBuyQuantity: 150,
    maxPerBuyQuantity: 15,
    lotteryMode: 1,
    virtual: 2,
    shippingType: 1,
    fakeSalesCount: 54,
    ...G3,
    desc: [
      '<img src="https://img.joyminis.com/images/treasure/jm-030-1.jpg" alt="Kindle Paperwhite" style="width:100%;border-radius:8px;margin-bottom:12px"/>',
      '<h3>Kindle Paperwhite 11th Gen</h3>',
      '<p>Read comfortably day or night with a glare-free e-reader designed for travel, commuting, and long reading sessions without eye strain.</p>',
      '<ul>',
      '<li>📚 6.8-inch glare-free display that reads like paper</li>',
      '<li>💡 Adjustable warm light for night reading</li>',
      '<li>🔋 Battery life that lasts for weeks</li>',
      '<li>🌊 Lightweight and travel-friendly design</li>',
      '</ul>',
      '<p><em>Brand new with charging cable and retail packaging.</em></p>',
    ].join(''),
    ruleContent: [
      '<h3>📦 What You Receive</h3>',
      '<ul>',
      '<li>1× Kindle Paperwhite 11th Gen (16GB)</li>',
      '<li>USB-C charging cable</li>',
      '<li>Retail box and quick-start guide</li>',
      '</ul>',
      '<h3>🎯 How the Draw Works</h3>',
      '<ol>',
      '<li>Purchase one or more shares at ₱58 per share</li>',
      '<li>Once all 150 shares are sold, one winner is randomly selected</li>',
      '<li>Winner announced within 24 hours via registered account</li>',
      "<li>Prize shipped to the winner's registered delivery address</li>",
      '</ol>',
      '<h3>⚠️ Terms & Conditions</h3>',
      '<p>Maximum 15 shares per user. All purchases are final. Metro Manila delivery 3–5 business days; provincial 5–7 business days.</p>',
    ].join(''),
    category: 'Lifestyle',
  },
];

export async function seedTreasures(
  options: SeedTreasuresOptions = {},
): Promise<Record<string, string>> {
  const { resetBeforeSeed = true } = options;
  const now = new Date();
  const endAt = daysLater(90);

  let tCreated = 0;
  let tUpdated = 0;
  let cCreated = 0;
  const seqToId: Record<string, string> = {};

  // 先取出所有分类，构建 name→id 映射
  const cats = await db.productCategory.findMany({
    select: { id: true, name: true },
  });
  const catMap: Record<string, number> = Object.fromEntries(
    cats.map((c: { id: number; name: string }) => [c.name, c.id]),
  );

  if (resetBeforeSeed) {
    const allSeqs = TREASURES.map((t) => t.treasureSeq);
    await resetSeededTreasuresBySeq(allSeqs);
    await resetLegacySeedTreasuresByName(LEGACY_TREASURE_NAMES);
  }

  for (const { category, mainImageList, ...rest } of TREASURES) {
    const soloAmount = rest.soloAmount ?? rest.marketAmount;
    const desc = normalizeRichHtmlForMobile(rest.desc);
    const ruleContent = normalizeRichHtmlForMobile(
      withPrizeGuide(rest.ruleContent),
    );
    const bonusConfig: Prisma.InputJsonValue = {
      bonusItemName: BONUS_GIFT_NAME,
      bonusItemImg: BONUS_GIFT_IMG_URL,
      winnerCount: 1,
    };

    const existed = await db.treasure.findUnique({
      where: { treasureSeq: rest.treasureSeq },
      select: { treasureId: true },
    });

    const t = await db.treasure.upsert({
      where: { treasureSeq: rest.treasureSeq },
      create: {
        ...rest,
        desc,
        soloAmount,
        bonusConfig,
        ruleContent,
        mainImageList: mainImageList as Prisma.InputJsonValue,
        salesStartAt: now,
        salesEndAt: endAt,
        state: 1, // 上架
        status: 'ACTIVE',
        enableRobot: true,
        robotDelay: 600, // 10 min 后机器人自动补齐
      },
      update: {
        ...rest,
        desc,
        soloAmount,
        bonusConfig,
        ruleContent,
        mainImageList: mainImageList as Prisma.InputJsonValue,
        state: 1,
        status: 'ACTIVE',
        enableRobot: true,
        robotDelay: 600,
      },
    });

    const treasureId = t.treasureId;
    if (existed) tUpdated++;
    else tCreated++;

    seqToId[rest.treasureSeq] = treasureId;

    // ── 产品-分类关联 TreasureCategory ──────────────────────
    await db.treasureCategory.deleteMany({ where: { treasureId } });
    const categoryId = catMap[category];
    if (categoryId) {
      await db.treasureCategory.create({ data: { treasureId, categoryId } });
      cCreated++;
    }
  }

  console.log(`   Treasure         +${tCreated} new, ~${tUpdated} updated`);
  console.log(`   TreasureCategory +${cCreated} new`);
  return seqToId;
}
