const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔥 Starting Chat Data Clear-up (Safe Mode)...');

  // 1. 定义需要清空的表（按外键依赖从子到父排序）
  // 顺序：隐藏记录 -> 消息记录 -> 成员记录 -> 会话主体
  const tables = [
    { name: 'ChatMessageHide', model: prisma.chatMessageHide },
    { name: 'ChatMessage', model: prisma.chatMessage },
    { name: 'ChatMember', model: prisma.chatMember },
    { name: 'Conversation', model: prisma.conversation },
  ];

  for (const table of tables) {
    console.log(`Processing Table: ${table.name}`);

    // 获取当前表的数据量，用于反馈
    const countBefore = await table.model.count();

    if (countBefore > 0) {
      // 执行清空操作
      const result = await table.model.deleteMany({});

      console.log(
        `   └─ Successfully deleted ${result.count} records from ${table.name}`,
      );
    } else {
      console.log(`   └─ Table ${table.name} is already empty. Skipping.`);
    }
  }

  // 2. 特殊重置逻辑 (可选)
  // 如果你的 Schema 中有其他关联表或需要重置自增序列，可以在这里添加 SQL $executeRaw

  console.log('✅ Chat Module Seeding/Clear-up Completed.');
}

main()
  .catch((e) => {
    // 捕获外键约束冲突等错误
    console.error('❌ Error during clearing chat data:');
    console.error(e.message);
    process.exit(1);
  })
  .finally(async () => {
    // 务必断开连接防止进程挂起
    await prisma.$disconnect();
  });

export {};
