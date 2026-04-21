// apps/api/scripts/seed/seed-payment-channels.ts
import { PrismaClient, Prisma } from '@prisma/client';

const db = new PrismaClient();

type PaymentChannelSeed = {
  code: string;
  name: string;
  icon?: string;
  type: number;
  currency: string;
  minAmount: number;
  maxAmount: number;
  fixedAmounts?: Prisma.InputJsonValue;
  isCustom: boolean;
  feeRate: number;
  feeFixed: number;
  sortOrder: number;
  status: number;
};

const CHANNELS: PaymentChannelSeed[] = [
  {
    code: 'PH_GCASH',
    name: 'GCash',
    icon: 'https://img.joyminis.com/images/payment/PH_GCASH.png',
    type: 1,
    currency: 'PHP',
    minAmount: 50,
    maxAmount: 50000,
    fixedAmounts: [100, 200, 500, 1000, 2000],
    isCustom: true,
    feeRate: 0,
    feeFixed: 0,
    sortOrder: 1,
    status: 1,
  },
  {
    code: 'PH_PAYMAYA',
    name: 'PayMaya',
    icon: 'https://img.joyminis.com/images/payment/PH_PAYMAYA.png',

    type: 1,
    currency: 'PHP',
    minAmount: 50,
    maxAmount: 50000,
    fixedAmounts: [100, 300, 500, 1000],
    isCustom: true,
    feeRate: 0,
    feeFixed: 0,
    sortOrder: 2,
    status: 1,
  },
  {
    code: 'PH_BDO',
    name: 'BDO Online',
    icon: 'https://img.joyminis.com/images/payment/bdo.png',
    type: 1,
    currency: 'PHP',
    minAmount: 100,
    maxAmount: 80000,
    fixedAmounts: [500, 1000, 3000, 5000],
    isCustom: true,
    feeRate: 0.01,
    feeFixed: 0,
    sortOrder: 3,
    status: 1,
  },
  {
    code: 'PH_BANK_WITHDRAW',
    name: 'Bank Transfer',
    icon: 'https://img.joyminis.com/images/payment/PH_BANK_WITHDRAW.jpg',
    type: 2,
    currency: 'PHP',
    minAmount: 200,
    maxAmount: 100000,
    isCustom: true,
    feeRate: 0.01,
    feeFixed: 10,
    sortOrder: 1,
    status: 1,
  },
  {
    code: 'PH_GCASH_WITHDRAW',
    name: 'GCash Withdraw',
    icon: 'https://img.joyminis.com/images/payment/PH_GCASH.png',
    type: 2,
    currency: 'PHP',
    minAmount: 100,
    maxAmount: 50000,
    isCustom: true,
    feeRate: 0.008,
    feeFixed: 5,
    sortOrder: 2,
    status: 1,
  },
];

export async function seedPaymentChannels() {
  let created = 0;
  let updated = 0;

  for (const channel of CHANNELS) {
    const exists = await db.paymentChannel.findUnique({
      where: { code: channel.code },
      select: { id: true },
    });

    if (exists) {
      await db.paymentChannel.update({
        where: { code: channel.code },
        data: channel,
      });
      updated++;
      continue;
    }

    await db.paymentChannel.create({ data: channel });
    created++;
  }

  console.log(`   PaymentChannel   +${created} new, ~${updated} updated`);
}
