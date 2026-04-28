// apps/api/scripts/seed/seed-support-channels.ts
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const db = new PrismaClient();

export async function seedSupportChannels() {
  let created = 0;

  // 定义需要创建的支持渠道
  const channels = [
    {
      id: 'official_platform_support_v1',
      name: 'Official Support',
      description: 'Official customer service channel (platform default)',
      botNickname: 'Official Support Bot',
      botPhone: '+6299999990',
    },
  ];

  for (const channel of channels) {
    // 1. 检查 SupportChannel 是否已存在
    const existingChannel = await db.supportChannel.findUnique({
      where: { id: channel.id },
      select: { id: true },
    });

    if (existingChannel) {
      continue;
    }

    // 2. 创建对应的 bot 用户（如果不存在）
    const existingBot = await db.user.findUnique({
      where: { phone: channel.botPhone },
      select: { id: true },
    });

    let botUserId: string;

    if (existingBot) {
      botUserId = existingBot.id;
    } else {
      const botUser = await db.user.create({
        data: {
          nickname: channel.botNickname,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=support_bot_${channel.id}`,
          phone: channel.botPhone,
          phoneMd5: createHash('md5').update(channel.botPhone).digest('hex'),
          isRobot: true,
          status: 1,
        },
      });
      botUserId = botUser.id;
    }

    // 3. 创建 SupportChannel
    await db.supportChannel.create({
      data: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        botUserId,
        isActive: true,
      },
    });

    created++;
  }

  console.log(`   Support Channels +${created} new`);
}
