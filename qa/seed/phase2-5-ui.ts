/**
 * Phase 2–5 UI seed: one problem cluster + one NEW alert + a regression dataset.
 *
 *   DATABASE_URL=... npx tsx qa/seed/phase2-5-ui.ts
 *   DATABASE_URL=... npx tsx qa/seed/phase2-5-ui.ts --clean
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'qa_p25_ui_';
const CLUSTER_ID = `${PREFIX}cluster`;
const ALERT_ID = `${PREFIX}alert`;
const DATASET_NAME = `${PREFIX}dataset`;
const DATASET_ID = `${PREFIX}ds`;
const REPRESENTATIVE = 'QA P25 界面问题 退款未到账?';

function signature(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 64);
}

async function clean() {
  await prisma.aiProblemClusterDay.deleteMany({
    where: { clusterId: { startsWith: PREFIX } },
  });
  await prisma.aiProblemCluster.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.aiAnalysisAlert.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.aiEvalDataset.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
}

async function seed() {
  const now = new Date();
  const day = new Date(
    `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
  );

  await prisma.aiProblemCluster.create({
    data: {
      id: CLUSTER_ID,
      signature: signature(REPRESENTATIVE),
      representativeText: REPRESENTATIVE,
      count: 100,
      severity: 3,
      intent: 'after_sales',
      suggestedCause: 'MODEL',
      status: 'NEW',
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
  await prisma.aiProblemClusterDay.create({
    data: {
      id: `${PREFIX}cluster_day`,
      clusterId: CLUSTER_ID,
      day,
      count: 100,
    },
  });
  await prisma.aiAnalysisAlert.create({
    data: {
      id: ALERT_ID,
      windowStart: day,
      metric: 'problem_rate',
      dimension: 'ALL',
      dimensionValue: 'ALL',
      value: 0.8,
      baseline: 0.1,
      sampleSize: 10,
      severity: 'HIGH',
      message: 'qa_p25_ui_alert_message',
      status: 'NEW',
    },
  });
  await prisma.aiEvalDataset.create({
    data: {
      id: DATASET_ID,
      name: DATASET_NAME,
      description: 'qa phase2-5 UI regression',
      createdBy: 'qa_admin_admin',
    },
  });
}

async function main() {
  const command = process.argv[2];
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
