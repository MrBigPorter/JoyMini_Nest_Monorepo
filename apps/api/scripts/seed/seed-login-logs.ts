// apps/api/scripts/seed/seed-login-logs.ts
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const TEST_PHONE = '+639171234567';

export async function seedLoginLogs() {
  const user = await db.user.findUnique({
    where: { phone: TEST_PHONE },
    select: { id: true, nickname: true },
  });

  if (!user) {
    console.log('  [skip] Login Logs   test user not found');
    return;
  }

  const robots = await db.user.findMany({
    where: { isRobot: true },
    take: 2,
    select: { id: true, nickname: true },
  });

  const actors = [user, ...robots];

  let created = 0;
  for (let i = 0; i < actors.length; i++) {
    const actor = actors[i];
    if (!actor) continue;

    const existing = await db.userLoginLog.findFirst({
      where: {
        userId: actor.id,
        loginDevice: 'Seed Demo Device',
      },
      select: { id: true },
    });

    if (existing) continue;

    await db.userLoginLog.create({
      data: {
        userId: actor.id,
        loginTime: new Date(Date.now() - i * 3600_000),
        loginType: i % 2 === 0 ? 1 : 3,
        loginMethod: i % 2 === 0 ? 'password' : 'google',
        loginIp: `192.168.10.${10 + i}`,
        loginDevice: 'Seed Demo Device',
        userAgent: 'SeedAgent/1.0',
        deviceId: `seed-device-${i + 1}`,
        countryCode: 'PH',
        city: i === 0 ? 'Makati' : 'Cebu City',
        loginStatus: i === 2 ? 0 : 1,
        failReason: i === 2 ? 'Wrong password' : null,
        tokenIssued: i === 2 ? 0 : 1,
      },
    });

    created++;
  }

  console.log(`   UserLoginLog      +${created} new`);
}
