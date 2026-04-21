// apps/api/scripts/seed/seed-robots.ts
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto'; // 用于生成 MD5

dotenv.config();

const db = new PrismaClient();

async function main() {
  console.log('🚀 开始生成机器人数据...');

  const robots = [];
  // 取时间戳的后 8 位，既能防止重复，又不会太长
  const timePart = Date.now().toString().slice(-8);

  for (let i = 0; i < 100; i++) {
    // 构造一个不超过 20 位的手机号
    // 格式: 9 + 时间戳后8位 + 序号 (例如: 98765432101)
    const shortPhone = `9${timePart}${i.toString().padStart(3, '0')}`;

    robots.push({
      nickname: `LuckyBot_${Math.floor(Math.random() * 9999)}`,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=bot_${timePart}_${i}`,

      //  修复点：确保长度 < 20
      phone: shortPhone,

      // phoneMd5 是 VarChar(32)，这里我们生成一个假的 MD5 占位即可
      phoneMd5: crypto
        .createHash('md5')
        .update(shortPhone)
        .digest('hex')
        .substring(0, 32),

      isRobot: true,
      status: 1,
    });
  }

  const result = await db.user.createMany({
    data: robots,
    skipDuplicates: true,
  });

  console.log(` 成功! 实际插入了 ${result.count} 个机器人用户。`);
}

main()
  .catch((e) => {
    console.error('❌ 发生错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
