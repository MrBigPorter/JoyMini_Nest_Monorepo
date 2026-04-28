// apps/api/scripts/seed/seed-wallet.ts
/**
 * 测试用户 + 钱包 (仅本地开发)
 * 创建一个固定测试账号并赋予余额，QA 可直接用该账号测试下单 / 提现
 *
 * phone:        +639171234567
 * realBalance:  ₱5,000
 * coinBalance:  1,000 coins
 *
 * 幂等: 按 phone 查重；wallet 按 userId upsert
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const db = new PrismaClient();

const TEST_PHONE = '+639171234567';
const WALLET = { realBalance: 5000, coinBalance: 1000 };

export async function seedTestUserWallet() {
  let user = await db.user.findUnique({ where: { phone: TEST_PHONE } });

  if (!user) {
    user = await db.user.create({
      data: {
        phone: TEST_PHONE,
        phoneMd5: createHash('md5').update(TEST_PHONE).digest('hex'),
        nickname: '🧪 Test User',
        inviteCode: 'TESTUSER',
        status: 1,
      },
    });
    console.log(`   Test User        created  id=${user.id}`);
  } else {
    console.log(`  ⏭️  Test User        skipped  id=${user.id}`);
  }

  await db.userWallet.upsert({
    where: { userId: user.id },
    update: WALLET,
    create: { userId: user.id, ...WALLET },
  });
  console.log(
    `   Test Wallet      realBalance=₱${WALLET.realBalance}  coins=${WALLET.coinBalance}`,
  );
}

// 直接运行该文件：node/ts-node 执行
if (require.main === module) {
  seedTestUserWallet()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
