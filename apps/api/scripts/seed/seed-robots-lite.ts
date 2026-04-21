// apps/api/scripts/seed/seed-robots-lite.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const db = new PrismaClient();

const ROBOT_COUNT = 30;

function robotPhone(index: number) {
  return `+6399900${String(index).padStart(4, '0')}`;
}

export async function seedRobotsLite() {
  let created = 0;

  for (let i = 1; i <= ROBOT_COUNT; i++) {
    const phone = robotPhone(i);
    const exists = await db.user.findUnique({
      where: { phone },
      select: { id: true },
    });

    if (exists) {
      continue;
    }

    await db.user.create({
      data: {
        nickname: `LuckyBot_${String(i).padStart(3, '0')}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=luckybot_${i}`,
        phone,
        phoneMd5: createHash('md5').update(phone).digest('hex'),
        isRobot: true,
        status: 1,
      },
    });
    created++;
  }

  console.log(`   Robot Users      +${created} new`);
}
