/**
 * 意图域 / 文档域注册表 seed（121-M0）
 *
 * 幂等规则：只灌空表。已有数据说明 DB 已是运行时事实来源，
 * 不能覆盖运营改过的描述、关键词或停用状态。
 *
 * 运行：
 *   yarn workspace @lucky/api seed:ai-domains
 */
import { PrismaClient } from '@prisma/client';
import { INTENT_DOMAIN_SEEDS } from '@api/client/ai-customer/graph/config/intent-domain-registry';
import { KNOWLEDGE_DOMAIN_SEEDS } from '@api/admin/rag/knowledge-domain.seeds';
import { loadEnvForHost } from '../utils/load-env-for-host';

loadEnvForHost();

const prisma = new PrismaClient();

async function main() {
  const intentCount = await prisma.intentDomain.count();
  if (intentCount === 0) {
    const result = await prisma.intentDomain.createMany({
      data: INTENT_DOMAIN_SEEDS.map((seed) => ({
        label: seed.label,
        description: seed.description,
        type: seed.type,
        agentTag: seed.agentTag,
        catchAll: seed.catchAll,
        keywords: seed.keywords,
        sortOrder: seed.sortOrder,
      })),
      skipDuplicates: true,
    });
    console.log(`✅ intent_domains seeded: ${result.count}`);
  } else {
    console.log(`↷ intent_domains already has ${intentCount} rows, skipped`);
  }

  const knowledgeCount = await prisma.knowledgeDomain.count();
  if (knowledgeCount === 0) {
    const result = await prisma.knowledgeDomain.createMany({
      data: KNOWLEDGE_DOMAIN_SEEDS,
      skipDuplicates: true,
    });
    console.log(`✅ knowledge_domains seeded: ${result.count}`);
  } else {
    console.log(
      `↷ knowledge_domains already has ${knowledgeCount} rows, skipped`,
    );
  }
}

main()
  .catch((error) => {
    console.error('❌ seed-ai-domains failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
