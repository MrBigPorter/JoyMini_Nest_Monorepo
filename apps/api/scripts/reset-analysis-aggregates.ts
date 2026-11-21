/**
 * 重置 AI 分析派生数据（默认 dry-run）。
 *
 * 只删 119 的派生表：分析运行、指标窗口、问题簇/簇日、告警。
 * 不删事件、反馈、trace、会话；重置后可在 /ai-ops/analysis 重新跑窗口。
 *
 * 用法：
 *   tsx --env-file=.env scripts/reset-analysis-aggregates.ts
 *   tsx --env-file=.env scripts/reset-analysis-aggregates.ts \
 *     --apply --confirm=RESET_ANALYSIS
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirm = argValue(args, 'confirm');

  const counts = {
    alerts: await prisma.aiAnalysisAlert.count(),
    clusterDays: await prisma.aiProblemClusterDay.count(),
    clusters: await prisma.aiProblemCluster.count(),
    metrics: await prisma.aiMetricWindow.count(),
    runs: await prisma.aiAnalysisRun.count(),
  };

  console.log(`[analysis-reset] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[analysis-reset] ${JSON.stringify(counts)}`);

  if (!apply) {
    console.log(
      '[analysis-reset] dry-run only. Pass --apply --confirm=RESET_ANALYSIS to delete.',
    );
    return;
  }
  if (confirm !== 'RESET_ANALYSIS') {
    throw new Error(
      'Refusing to delete: pass --confirm=RESET_ANALYSIS with --apply',
    );
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const alerts = await tx.aiAnalysisAlert.deleteMany();
    const clusterDays = await tx.aiProblemClusterDay.deleteMany();
    const clusters = await tx.aiProblemCluster.deleteMany();
    const metrics = await tx.aiMetricWindow.deleteMany();
    const runs = await tx.aiAnalysisRun.deleteMany();
    return {
      alerts: alerts.count,
      clusterDays: clusterDays.count,
      clusters: clusters.count,
      metrics: metrics.count,
      runs: runs.count,
    };
  });

  console.log('[analysis-reset] deleted:', JSON.stringify(deleted));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
