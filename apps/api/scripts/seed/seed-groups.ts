// apps/api/scripts/seed/seed-groups.ts
/**
 * 拼团演示数据 (TreasureGroup + TreasureGroupMember)
 *
 * 依赖链: seedTreasures → seedTestUserWallet → seedGroups
 *
 * 策略:
 *   - 为 JM-001~JM-006 各创建一个「进行中」的拼团（团长 = 测试用户）
 *   - 再为 JM-001 追加 2 个机器人成员，模拟半满状态
 *
 * TreasureGroup 字段说明:
 *   groupStatus : 1=进行中  2=拼团成功  3=失败/过期
 *   status      : 0=正常    1=归档
 *   expireAt    : 截止时间（= 创建时间 + groupTimeLimit 秒）
 *
 * 幂等: 按 (treasureId, creatorId, groupStatus=1) 各只创建一条记录
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const TEST_PHONE = '+639171234567';

// 每个产品想要展示的额外机器人成员数 (0 表示只有团长)
const ROBOT_EXTRAS: Record<string, number> = {
  'JM-001': 2, // iPhone 展示 3/5 成团
  'JM-002': 1, // S25 Ultra 展示 2/5
  'JM-003': 1, // PS5 展示 2/3
  'JM-004': 0,
  'JM-005': 0,
  'JM-006': 0,
};

const SEQS = Object.keys(ROBOT_EXTRAS);

export async function seedGroups() {
  // ── 依赖检查 ──────────────────────────────────────────────
  const testUser = await db.user.findUnique({ where: { phone: TEST_PHONE } });
  if (!testUser) {
    console.log(
      '  ⚠️  seedGroups       skipped (test user not found, run seedTestUserWallet first)',
    );
    return;
  }

  // 取一批机器人用户备用
  const robots = await db.user.findMany({
    where: { isRobot: true },
    take: 10,
    select: { id: true },
  });

  let gCreated = 0;
  let mCreated = 0;

  for (const seq of SEQS) {
    const treasure = await db.treasure.findUnique({
      where: { treasureSeq: seq },
    });
    if (!treasure) continue;

    // 幂等: 只要有一条该产品 + 该用户的进行中拼团就跳过
    const existing = await db.treasureGroup.findFirst({
      where: {
        treasureId: treasure.treasureId,
        creatorId: testUser.id,
        groupStatus: 1,
      },
    });
    if (existing) continue;

    // 拼团截止 = 现在 + groupTimeLimit 秒
    const expireAt = new Date(Date.now() + treasure.groupTimeLimit * 1000);

    const robotCount = ROBOT_EXTRAS[seq] ?? 0;
    const currentMembers = 1 + robotCount; // 团长 + 机器人

    const group = await db.treasureGroup.create({
      data: {
        treasureId: treasure.treasureId,
        creatorId: testUser.id,
        groupName: `${treasure.treasureName} Lucky Group`,
        groupAvatar: treasure.treasureCoverImg ?? undefined,
        maxMembers: treasure.groupSize,
        currentMembers,
        groupStatus: 1,
        expireAt,
        status: 1,
        isSystemFilled: false,
      } as Parameters<typeof db.treasureGroup.create>[0]['data'],
    });
    gCreated++;

    // ── 团长成员记录 ──────────────────────────────────────
    await db.treasureGroupMember.create({
      data: {
        groupId: group.groupId,
        userId: testUser.id,
        isOwner: 1,
        memberType: 0, // 真实用户
      },
    });
    mCreated++;

    // ── 机器人成员 ────────────────────────────────────────
    for (let i = 0; i < robotCount && i < robots.length; i++) {
      const robot = robots[i];
      // 避免和团长重复
      if (robot.id === testUser.id) continue;

      const alreadyIn = await db.treasureGroupMember.findUnique({
        where: { groupId_userId: { groupId: group.groupId, userId: robot.id } },
      });
      if (!alreadyIn) {
        await db.treasureGroupMember.create({
          data: {
            groupId: group.groupId,
            userId: robot.id,
            isOwner: 0,
            memberType: 1, // 机器人
          },
        });
        mCreated++;
      }
    }
  }

  console.log(`   TreasureGroup    +${gCreated} new`);
  console.log(`   GroupMember      +${mCreated} new`);
}
