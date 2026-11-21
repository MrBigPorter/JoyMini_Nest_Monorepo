/**
 * Operator surface QA seed (119 quality page actions).
 *
 *   DATABASE_URL=... npx tsx qa/seed/operator-surface.ts
 *   DATABASE_URL=... npx tsx qa/seed/operator-surface.ts --clean
 *   DATABASE_URL=... npx tsx qa/seed/operator-surface.ts inspect
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'qa_op_';

async function clean() {
  await prisma.aiAnswerFeedback.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.conversation.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
}

async function seed() {
  const base = new Date('2027-03-01T10:00:00.000Z').getTime();
  const at = (offsetSeconds: number) => new Date(base - offsetSeconds * 1000);

  await prisma.conversation.createMany({
    data: [
      {
        id: `${PREFIX}conv_1`,
        type: 'SUPPORT',
        name: 'qa_op_conv_1',
        status: 1,
        transferReason: 'explicit_request',
        handlerId: 'qa_admin_admin',
      },
      {
        id: `${PREFIX}conv_2`,
        type: 'SUPPORT',
        name: 'qa_op_conv_2',
        status: 1,
        transferReason: 'ai_error',
        handlerId: 'awaiting_human',
      },
    ],
  });

  await prisma.aiAnswerFeedback.createMany({
    data: [
      {
        id: `${PREFIX}fb_service_1`,
        conversationId: `${PREFIX}conv_1`,
        source: 'implicit',
        failureKind: 'SERVICE_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        input: 'qa_op_service_input_1',
        createdAt: at(10),
      },
      {
        id: `${PREFIX}fb_service_2`,
        conversationId: `${PREFIX}conv_2`,
        source: 'implicit',
        failureKind: 'SERVICE_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        input: 'qa_op_service_input_2',
        createdAt: at(20),
      },
      {
        id: `${PREFIX}fb_model_1`,
        conversationId: `${PREFIX}conv_1`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        input: 'qa_op_model_input_1',
        createdAt: at(30),
      },
      {
        id: `${PREFIX}fb_model_2`,
        conversationId: `${PREFIX}conv_2`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
        input: 'qa_op_model_input_2',
        createdAt: at(40),
      },
      {
        id: `${PREFIX}fb_confirmed_1`,
        conversationId: `${PREFIX}conv_1`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'CONFIRMED',
        reviewStatus: 'REVIEWED',
        ownerAdminId: 'qa_admin_admin',
        input: 'qa_op_confirmed_input_1',
        createdAt: at(50),
      },
      {
        id: `${PREFIX}fb_confirmed_2`,
        conversationId: `${PREFIX}conv_1`,
        source: 'explicit',
        verdict: 'incorrect',
        failureKind: 'MODEL_ERROR',
        resolution: 'CONFIRMED',
        reviewStatus: 'REVIEWED',
        ownerAdminId: 'qa_admin_admin',
        input: 'qa_op_confirmed_input_2',
        createdAt: at(60),
      },
    ],
  });
}

async function main() {
  const command = process.argv[2];
  if (command === 'inspect') {
    const rows = await prisma.aiAnswerFeedback.findMany({
      where: { id: { startsWith: PREFIX } },
      select: {
        id: true,
        reviewStatus: true,
        resolution: true,
        failureKind: true,
        ownerAdminId: true,
      },
      orderBy: { id: 'asc' },
    });
    console.log(JSON.stringify(rows));
    return;
  }
  await clean();
  if (command !== '--clean') await seed();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
