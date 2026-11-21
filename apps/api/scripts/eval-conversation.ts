/**
 * Phase 1：对已落库的多轮会话跑确定性 evaluator（只读）。
 *
 * 用法（在 apps/api 下）：
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/eval-conversation.ts \
 *     --selection ../../tools/eval/conversation/selection-2026-11-21.jsonl
 *
 * 不调用 LLM、不写业务表；只读 ChatMessage / AiTrace，输出 JSON + Markdown 报告。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  evaluateDeterministic,
  isDrillConversation,
  roleOf,
} from '../src/admin/ai-eval/evaluators/deterministic';
import {
  ConversationSnapshot,
  DETERMINISTIC_EVALUATORS,
  EvalFeedback,
  DEFAULT_MAX_LATENCY_MS,
} from '../src/admin/ai-eval/evaluators/types';

const prisma = new PrismaClient();

interface SelectionRow {
  id: string;
  datasetVersion: string;
  conversationId: string;
  source: 'real' | 'sim' | 'drill';
  language: 'zh' | 'en' | 'mixed';
  intent: string;
  tags?: string[];
  note?: string;
}

interface ConversationResult {
  id: string;
  conversationId: string;
  source: string;
  language: string;
  intent: string;
  drill: boolean;
  messageCount: number;
  traceCount: number;
  feedback: EvalFeedback[];
}

function readSelection(path: string): SelectionRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as SelectionRow);
}

function wilson(success: number, n: number, z = 1.96) {
  if (n === 0) return null;
  const p = success / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

type CountRow = {
  pass: number;
  fail: number;
  unknown: number;
  rate: number | null;
};

type CountsByKey = Record<string, CountRow>;

type SliceCounts = Record<string, CountsByKey>;

function countsByKey(feedback: EvalFeedback[]): CountsByKey {
  const result: CountsByKey = {};
  for (const item of feedback) {
    const row = (result[item.key] ??= {
      pass: 0,
      fail: 0,
      unknown: 0,
      rate: null,
    });
    row[item.status] += 1;
  }
  for (const row of Object.values(result)) {
    const decided = row.pass + row.fail;
    row.rate = decided > 0 ? row.pass / decided : null;
  }
  return result;
}

function pct(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatRate(row: { pass: number; fail: number; rate: number | null }) {
  const n = row.pass + row.fail;
  const ci = row.rate == null ? null : wilson(row.pass, n);
  return `${pct(row.rate)} (${row.pass}/${n}${ci ? `, 95% CI ${(ci.low * 100).toFixed(1)}%–${(ci.high * 100).toFixed(1)}%` : ''})`;
}

async function loadSnapshot(row: SelectionRow): Promise<ConversationSnapshot> {
  const [messages, traces, actions] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { conversationId: row.conversationId },
      orderBy: { seqId: 'asc' },
      select: {
        id: true,
        content: true,
        source: true,
        createdAt: true,
        triggerMessageId: true,
      },
    }),
    prisma.aiTrace.findMany({
      where: { conversationId: row.conversationId },
      select: {
        id: true,
        triggerMessageId: true,
        aiMessageId: true,
        createdAt: true,
      },
    }),
    prisma.aiActionRequest.findMany({
      where: { conversationId: row.conversationId },
      select: {
        id: true,
        messageId: true,
        action: true,
        status: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
  ]);

  return {
    conversationId: row.conversationId,
    source: row.source,
    messages: messages.map((message) => ({
      id: message.id,
      role: roleOf(message.source),
      content: message.content ?? '',
      createdAt: message.createdAt,
      triggerMessageId: message.triggerMessageId,
    })),
    traces,
    actions,
  };
}

function buildMarkdown(
  results: ConversationResult[],
  aggregates: CountsByKey,
  slices: Record<string, SliceCounts>,
  datasetVersion: string,
  runId: string,
): string {
  const lines: string[] = [];
  lines.push(`# 多轮确定性评测 — ${runId}`);
  lines.push('');
  lines.push(`- datasetVersion: \`${datasetVersion}\``);
  lines.push(`- 会话数: ${results.length}`);
  lines.push(
    `- drill 会话（不计入聚合）: ${results.filter((r) => r.drill).length}`,
  );
  lines.push('');

  lines.push('## 总体（不含 drill）');
  lines.push('');
  lines.push('| key | pass | fail | unknown | 通过率 |');
  lines.push('|---|---:|---:|---:|---|');
  for (const [key, row] of Object.entries(aggregates)) {
    lines.push(
      `| ${key} | ${row.pass} | ${row.fail} | ${row.unknown} | ${formatRate(row)} |`,
    );
  }
  lines.push('');

  for (const [dimension, groups] of Object.entries(slices)) {
    lines.push(`## 切片：${dimension}`);
    lines.push('');
    lines.push('| 值 | key | 通过率 |');
    lines.push('|---|---|---|');
    for (const [value, byKey] of Object.entries(groups)) {
      for (const [key, row] of Object.entries(byKey)) {
        lines.push(`| ${value} | ${key} | ${formatRate(row)} |`);
      }
    }
    lines.push('');
  }

  const failures = results.flatMap((result) =>
    result.feedback
      .filter((item) => item.status === 'fail')
      .map((item) => ({ result, item })),
  );
  lines.push('## 失败明细');
  lines.push('');
  if (failures.length === 0) {
    lines.push('无');
  } else {
    lines.push('| 会话 | source | turn | key | 说明 |');
    lines.push('|---|---|---:|---|---|');
    for (const { result, item } of failures) {
      lines.push(
        `| ${result.id}${result.drill ? '（drill）' : ''} | ${result.source} | ${item.turn} | ${item.key} | ${item.comment.replace(/\|/g, '\\|')} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(__dirname, '../../..');
  const argValue = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const hit = args.find((arg) => arg.startsWith(prefix));
    return hit?.slice(prefix.length);
  };
  const pathArg = (name: string, fallback: string): string => {
    const value = argValue(name);
    return resolve(root, value ?? fallback);
  };

  const datasetArg = argValue('dataset');
  const finalSelectionPath = datasetArg
    ? resolve(root, datasetArg)
    : pathArg('selection', 'tools/eval/conversation/selection-2026-11-21.jsonl');
  const outDir = pathArg('out-dir', 'tools/eval/conversation/reports');
  const maxLatencyMs = Number(
    argValue('max-latency-ms') ?? DEFAULT_MAX_LATENCY_MS,
  );

  const selection = readSelection(finalSelectionPath);
  if (selection.length === 0) throw new Error('selection is empty');
  const datasetVersions = new Set(selection.map((row) => row.datasetVersion));
  if (datasetVersions.size !== 1) {
    throw new Error(`mixed datasetVersion: ${[...datasetVersions].join(', ')}`);
  }

  const results: ConversationResult[] = [];
  const startedAt = new Date().toISOString();
  for (const row of selection) {
    const snapshot = await loadSnapshot(row);
    const drill = isDrillConversation(snapshot);
    const feedback = evaluateDeterministic(snapshot, { maxLatencyMs });
    results.push({
      id: row.id,
      conversationId: row.conversationId,
      source: row.source,
      language: row.language,
      intent: row.intent,
      drill,
      messageCount: snapshot.messages.length,
      traceCount: snapshot.traces.length,
      feedback,
    });
    console.log(
      `[eval] ${row.id} msgs=${snapshot.messages.length} traces=${snapshot.traces.length} drill=${drill} fails=${feedback.filter((f) => f.status === 'fail').length}`,
    );
  }

  const scored = results.filter((result) => !result.drill);
  const aggregates = countsByKey(scored.flatMap((result) => result.feedback));
  const slices: Record<string, SliceCounts> = {};
  for (const [dimension, selector] of [
    ['language', (result: ConversationResult) => result.language],
    ['intent', (result: ConversationResult) => result.intent],
    ['source', (result: ConversationResult) => result.source],
  ] as const) {
    const groups: SliceCounts = {};
    const values = new Set(scored.map(selector));
    for (const value of values) {
      groups[value] = countsByKey(
        scored
          .filter((result) => selector(result) === value)
          .flatMap((result) => result.feedback),
      );
    }
    slices[dimension] = groups;
  }

  const runId = `conv-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const finishedAt = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, `${runId}.json`);
  const mdPath = resolve(outDir, `${runId}.md`);
  const feedbackPath = resolve(outDir, `${runId}.feedback.jsonl`);
  const evaluatorVersions = Object.fromEntries(
    DETERMINISTIC_EVALUATORS.map((item) => [item.key, item.version]),
  );
  const feedbackRows = results.flatMap((result) =>
    result.feedback.map((item) => ({
      caseId: result.id,
      turn: item.turn,
      key: item.key,
      scoreType: 'boolean',
      ...(item.score == null ? {} : { score: item.score }),
      value: item.status,
      comment: item.comment.slice(0, 200),
      source: 'CODE',
      evaluatorVersion: evaluatorVersions[item.key],
      judgeVersion: null,
      runId,
    })),
  );

  const report = {
    runId,
    datasetVersion: [...datasetVersions][0],
    generatedAt: finishedAt,
    manifest: {
      runId,
      datasetVersion: [...datasetVersions][0],
      caseCount: results.length,
      repetitions: 1,
      model: 'stored-replay',
      promptVersions: {},
      ragIndexVersion: 'n/a',
      judgeVersion: null,
      evaluatorVersions,
      startedAt,
      finishedAt,
    },
    aggregates,
    slices,
    drillConversations: results.filter((result) => result.drill).map((r) => r.id),
    conversations: results,
  };

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(
    feedbackPath,
    `${feedbackRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
  writeFileSync(
    mdPath,
    buildMarkdown(
      results,
      aggregates,
      slices,
      [...datasetVersions][0],
      runId,
    ),
    'utf8',
  );

  console.log('\n[eval] overall (non-drill):');
  for (const [key, row] of Object.entries(aggregates)) {
    console.log(`  ${key}: ${formatRate(row)} unknown=${row.unknown}`);
  }
  console.log(`[eval] report: ${mdPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
