// scripts/seed/seed-coupons.ts
/**
 * 优惠券模板 (Coupon) × 4
 *
 *  code       名称                 类型            规则                  发放方式
 *  WELCOME50  新用户欢迎券          满减(1)         满₱200减₱50           系统(1) | 领后7天
 *  VIP90      VIP九折券            折扣(2)         满₱500打9折，上限₱100  系统(1) | 固定30天
 *  FREE30     无门槛现金券          无门槛现金(3)   直减₱30               系统(1) | 领后7天
 *  BIG200     大额满减券            满减(1)         满₱1,000减₱200        用户领取(2) | 固定30天
 *
 * couponType  : 1=满减  2=折扣  3=无门槛现金
 * discountType: 1=固定金额  2=百分比（如 0.90 = 9折）
 * issueType   : 1=系统发放  2=用户主动领取  3=兑换码  4=邀请奖励
 * validType   : 1=固定日期范围  2=领券后N天有效
 *
 * 幂等: 按 couponCode (@unique) 查重
 *
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const daysLater = (d: number) => new Date(Date.now() + d * 86_400_000);

const COUPONS = [
  // ① 新用户欢迎券：满₱200减₱50
  {
    couponName: '🎁 New User Welcome Coupon',
    couponCode: 'WELCOME50',
    subTitle: '₱50 off on orders ₱200+',
    description:
      'Welcome gift for new JoyMinis users. Valid for 7 days after claiming.',
    couponType: 1, // 满减
    discountType: 1, // 固定金额
    discountValue: 50,
    minPurchase: 200,
    maxDiscount: null,
    issueType: 1, // 系统发放
    totalQuantity: 500,
    perUserLimit: 1,
    validType: 2, // 领后N天
    validDays: 7,
    status: 1,
  },
  // ② VIP折扣券：满₱500打9折，最多抵₱100
  {
    couponName: '👑 VIP 10% Discount',
    couponCode: 'VIP90',
    subTitle: '10% off (max ₱100 discount)',
    description: 'VIP exclusive: 10% off orders of ₱500+. Max discount ₱100.',
    couponType: 2, // 折扣
    discountType: 2, // 百分比
    discountValue: 0.9, // 9折 = 10% off
    minPurchase: 500,
    maxDiscount: 100,
    issueType: 1,
    totalQuantity: 200,
    perUserLimit: 1,
    validType: 1, // 固定日期
    validStartAt: new Date(),
    validEndAt: daysLater(30),
    status: 1,
  },
  // ③ 无门槛现金券：直减₱30
  {
    couponName: '🎉 Free ₱30 Bonus',
    couponCode: 'FREE30',
    subTitle: '₱30 off — no minimum spend',
    description:
      'No strings attached! ₱30 off on any product. Valid 7 days after claiming.',
    couponType: 3, // 无门槛现金
    discountType: 1,
    discountValue: 30,
    minPurchase: 0,
    maxDiscount: null,
    issueType: 1,
    totalQuantity: 1000,
    perUserLimit: 1,
    validType: 2,
    validDays: 7,
    status: 1,
  },
  // ④ 大额满减：满₱1,000减₱200
  {
    couponName: '💰 Big Spender — ₱200 Off',
    couponCode: 'BIG200',
    subTitle: '₱200 off on orders ₱1,000+',
    description:
      'For big spenders! ₱200 off orders of ₱1,000 or more. Limited 100 coupons.',
    couponType: 1,
    discountType: 1,
    discountValue: 200,
    minPurchase: 1000,
    maxDiscount: null,
    issueType: 2, // 用户主动领取
    totalQuantity: 100,
    perUserLimit: 1,
    validType: 1,
    validStartAt: new Date(),
    validEndAt: daysLater(30),
    status: 1,
  },
];

export async function seedCoupons() {
  let created = 0;
  for (const { maxDiscount, ...row } of COUPONS) {
    const e = await db.coupon.findUnique({
      where: { couponCode: row.couponCode },
    });
    if (!e) {
      await db.coupon.create({
        data: {
          ...row,
          ...(maxDiscount != null ? { maxDiscount } : {}),
        },
      });
      created++;
    }
  }
  console.log(`   Coupon           +${created} new`);
}
