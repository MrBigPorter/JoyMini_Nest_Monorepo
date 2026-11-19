/**
 * AI 评测 fixture（ai-quality-loop 3.2）
 *
 * 预置一个固定用户与订单/钱包/券/KYC/抽奖/充值提现数据，供任务成功率评测使用。
 * 全部按唯一键 upsert，可重复执行；只影响 aiq_ / AIQ 前缀的数据。
 *
 * 运行：
 *   docker exec -w /app/apps/api lucky-backend-dev \
 *     yarn workspace @lucky/api seed:ai-eval-fixture
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost();

const prisma = new PrismaClient();

const USER_ID = 'aiq_fixture_user_01';
const PHONE = '+639000000001';
const TREASURE_ID = 'aiq_fixture_treasure_01';

function days(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function main() {
  const user = await prisma.user.upsert({
    where: { phone: PHONE },
    create: {
      id: USER_ID,
      phone: PHONE,
      phoneMd5: createHash('md5').update(PHONE).digest('hex'),
      nickname: 'AI Eval User',
      inviteCode: 'AIQEVAL01',
      vipLevel: 2,
      kycStatus: 4,
      status: 1,
      lastLoginAt: new Date(Date.now() - 60 * 60 * 1000),
    },
    update: {
      nickname: 'AI Eval User',
      vipLevel: 2,
      kycStatus: 4,
      status: 1,
    },
  });

  await prisma.userWallet.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      realBalance: 1250.0,
      coinBalance: 320,
      frozenBalance: 50.0,
      totalRecharge: 2000.0,
      totalWithdraw: 750.0,
    },
    update: {
      realBalance: 1250.0,
      coinBalance: 320,
      frozenBalance: 50.0,
      totalRecharge: 2000.0,
      totalWithdraw: 750.0,
    },
  });

  await prisma.treasure.upsert({
    where: { treasureId: TREASURE_ID },
    create: {
      treasureId: TREASURE_ID,
      treasureSeq: 'AIQ-001',
      treasureName: 'Fixture Wireless Earbuds',
      productName: 'Fixture Wireless Earbuds',
      treasureCoverImg: 'https://placehold.co/400x400?text=AIQ',
      unitAmount: 250.0,
      marketAmount: 499.0,
      seqShelvesQuantity: 100,
      seqBuyQuantity: 12,
      virtual: 2,
      state: 1,
      shippingType: 1,
    },
    update: { state: 1, seqShelvesQuantity: 100 },
  });

  await prisma.order.upsert({
    where: { orderNo: 'AIQ202611190001' },
    create: {
      orderId: 'aiq_fixture_order_paid_01',
      orderNo: 'AIQ202611190001',
      userId: user.id,
      treasureId: TREASURE_ID,
      originalAmount: 500.0,
      discountAmount: 0,
      couponAmount: 50.0,
      coinAmount: 0,
      finalAmount: 450.0,
      buyQuantity: 2,
      unitPrice: 250.0,
      orderStatus: 3,
      payStatus: 1,
      refundStatus: 0,
      paidAt: days(-2),
      shippingStatus: 1,
      trackingNo: 'PH123456789',
    },
    update: {
      orderStatus: 3,
      payStatus: 1,
      refundStatus: 0,
      shippingStatus: 1,
      trackingNo: 'PH123456789',
    },
  });

  await prisma.order.upsert({
    where: { orderNo: 'AIQ202611190002' },
    create: {
      orderId: 'aiq_fixture_order_unpaid_01',
      orderNo: 'AIQ202611190002',
      userId: user.id,
      treasureId: TREASURE_ID,
      originalAmount: 250.0,
      discountAmount: 0,
      couponAmount: 0,
      coinAmount: 0,
      finalAmount: 250.0,
      buyQuantity: 1,
      unitPrice: 250.0,
      orderStatus: 1,
      payStatus: 0,
      refundStatus: 0,
    },
    update: { orderStatus: 1, payStatus: 0 },
  });

  await prisma.coupon.upsert({
    where: { couponCode: 'AIQFI10' },
    create: {
      id: 'aiq_fixture_coupon_01',
      couponName: 'Fixture ₱10 Off',
      couponCode: 'AIQFI10',
      couponType: 1,
      discountType: 1,
      discountValue: 10.0,
      minPurchase: 100.0,
      issueType: 2,
      totalQuantity: 100,
      issuedQuantity: 1,
      perUserLimit: 1,
      validType: 1,
      validStartAt: days(-1),
      validEndAt: days(30),
      status: 1,
    },
    update: { status: 1, validStartAt: days(-1), validEndAt: days(30) },
  });

  await prisma.userCoupon.upsert({
    where: { id: 'aiq_fixture_usercoupon_01' },
    create: {
      id: 'aiq_fixture_usercoupon_01',
      userId: user.id,
      couponId: 'aiq_fixture_coupon_01',
      receiveType: 2,
      status: 0,
      validStartAt: days(-1),
      validEndAt: days(30),
    },
    update: { status: 0, validEndAt: days(30) },
  });

  await prisma.kycRecord.upsert({
    where: { id: 'aiq_fixture_kyc_01' },
    create: {
      id: 'aiq_fixture_kyc_01',
      userId: user.id,
      kycStatus: 4,
      idType: 1,
      idNumber: 'P1234567A',
      realName: 'Fixture User',
      nationality: 'PH',
      birthday: new Date('1995-05-01'),
      submittedAt: days(-10),
      auditedAt: days(-9),
      isSameAddress: true,
    },
    update: { kycStatus: 4, auditedAt: days(-9) },
  });

  await prisma.luckyDrawActivity.upsert({
    where: { id: 'aiq_fixture_lucky_activity_01' },
    create: {
      id: 'aiq_fixture_lucky_activity_01',
      title: 'Fixture Lucky Draw',
      description: 'AI eval fixture',
      status: 1,
      startAt: days(-1),
      endAt: days(30),
    },
    update: { status: 1, startAt: days(-1), endAt: days(30) },
  });

  await prisma.luckyDrawPrize.upsert({
    where: { id: 'aiq_fixture_lucky_prize_01' },
    create: {
      id: 'aiq_fixture_lucky_prize_01',
      activityId: 'aiq_fixture_lucky_activity_01',
      prizeType: 2,
      prizeName: '50 Coins',
      prizeValue: 50,
      probability: 100,
      stock: -1,
      sortOrder: 1,
    },
    update: { probability: 100, stock: -1 },
  });

  await prisma.luckyDrawTicket.upsert({
    where: {
      orderId_activityId: {
        orderId: 'aiq_fixture_order_paid_01',
        activityId: 'aiq_fixture_lucky_activity_01',
      },
    },
    create: {
      id: 'aiq_fixture_ticket_01',
      userId: user.id,
      activityId: 'aiq_fixture_lucky_activity_01',
      orderId: 'aiq_fixture_order_paid_01',
      used: false,
      expireAt: days(30),
    },
    update: { used: false, expireAt: days(30) },
  });

  await prisma.rechargeOrder.upsert({
    where: { rechargeNo: 'AIQR202611190001' },
    create: {
      rechargeNo: 'AIQR202611190001',
      userId: user.id,
      rechargeAmount: 500.0,
      actualAmount: 500.0,
      paymentMethod: 1,
      rechargeStatus: 1,
      paidAt: days(-3),
      completedAt: days(-3),
    },
    update: { rechargeStatus: 1 },
  });

  await prisma.withdrawOrder.upsert({
    where: { withdrawNo: 'AIQW202611190001' },
    create: {
      withdrawNo: 'AIQW202611190001',
      userId: user.id,
      withdrawAmount: 200.0,
      feeAmount: 2.0,
      actualAmount: 198.0,
      withdrawMethod: 1,
      withdrawAccount: PHONE,
      withdrawStatus: 1,
      completedAt: days(-1),
    },
    update: { withdrawStatus: 1 },
  });

  console.log(`✅ AI eval fixture ready: user=${user.id}`);
}

main()
  .catch((e) => {
    console.error('❌ AI eval fixture failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
