/**
 * 重算历史隐式反馈的归因（一次性，可重复执行）。
 *
 * 背景：隐式反馈的派生规则在 2026-11-21 才按 metadata.reason / signal 细分，
 * 更早写入的行统一兜底成了 SERVICE_ERROR，运营看到「服务故障」会查错方向。
 *
 * 安全边界：
 * - 只处理 source='implicit' 且 reviewedBy IS NULL 的行（不覆盖人工结论）
 * - 只重算 failureKind / resolution / reviewStatus 三个派生字段
 * - 默认 dry-run，必须显式 --apply 才写库
 *
 * 用法：
 *   yarn workspace @lucky/api tsx scripts/backfill-implicit-feedback-triage.ts
 *   yarn workspace @lucky/api tsx scripts/backfill-implicit-feedback-triage.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import {
  deriveImplicit,
  type FeedbackSignal,
} from '../src/common/ai/feedback-triage';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

const SIGNALS: FeedbackSignal[] = [
  'transferred',
  'repeated_question',
  'abandoned',
];

function isSignal(value: string | null): value is FeedbackSignal {
  return value != null && (SIGNALS as string[]).includes(value);
}

async function main() {
  console.log(
    `[backfill] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} (add --apply to write)`,
  );

  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  let skipped = 0;
  const byKind = new Map<string, number>();
  const samples: Array<{ id: string; from: string | null; to: string | null }> =
    [];

  for (;;) {
    const rows = await prisma.aiAnswerFeedback.findMany({
      where: {
        source: 'implicit',
        reviewedBy: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        signal: true,
        metadata: true,
        failureKind: true,
        resolution: true,
        reviewStatus: true,
      },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      cursor = row.id;

      if (!isSignal(row.signal)) {
        skipped += 1;
        continue;
      }

      const derived = deriveImplicit(
        row.signal,
        (row.metadata ?? undefined) as Record<string, unknown> | undefined,
      );

      const next = {
        failureKind: derived.failureKind,
        resolution: derived.resolution,
        reviewStatus: derived.reviewStatus,
      };
      const same =
        row.failureKind === next.failureKind &&
        row.resolution === next.resolution &&
        row.reviewStatus === next.reviewStatus;
      if (same) continue;

      changed += 1;
      byKind.set(
        `${row.failureKind ?? 'null'} -> ${next.failureKind ?? 'null'}`,
        (byKind.get(`${row.failureKind ?? 'null'} -> ${next.failureKind ?? 'null'}`) ??
          0) + 1,
      );
      if (samples.length < 10) {
        samples.push({
          id: row.id,
          from: row.failureKind,
          to: next.failureKind,
        });
      }

      if (APPLY) {
        await prisma.aiAnswerFeedback.update({
          where: { id: row.id },
          data: next,
        });
      }
    }

    console.log(
      `[backfill] scanned=${scanned} changed=${changed} skipped=${skipped}`,
    );
  }

  console.log('\n[backfill] failureKind transitions:');
  for (const [transition, count] of [...byKind.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${transition}: ${count}`);
  }
  if (samples.length > 0) {
    console.log('\n[backfill] sample rows:');
    for (const row of samples) {
      console.log(`  ${row.id}: ${row.from ?? 'null'} -> ${row.to ?? 'null'}`);
    }
  }
  console.log(
    `\n[backfill] done: scanned=${scanned}, changed=${changed}, skipped=${skipped}` +
      (APPLY ? '' : ' (dry-run, nothing written)'),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
