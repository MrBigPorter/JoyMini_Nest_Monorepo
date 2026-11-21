/**
 * 导出人工标注工作表（只读）。
 *
 * 从 selection JSONL 读取会话，按轮导出 question/answer，标签留空。
 * 标注者填 correctness/helpfulness/tone_safety 后，用 annotate.py 算 kappa。
 *
 * 用法（apps/api 下）：
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/export-annotation-worksheet.ts \
 *     --dataset ../../tools/eval/conversation/selection-2026-11-21.jsonl \
 *     --out ../../tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl \
 *     --max-turns-per-case=2
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  pairTurns,
  roleOf,
} from '../src/admin/ai-eval/evaluators/deterministic';

const prisma = new PrismaClient();

interface SelectionRow {
  id: string;
  conversationId: string;
  source: string;
  language: string;
  intent: string;
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function readSelection(path: string): SelectionRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as SelectionRow);
}

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(__dirname, '../../..');
  const datasetPath = resolve(
    root,
    argValue(args, 'dataset') ??
      'tools/eval/conversation/selection-2026-11-21.jsonl',
  );
  const outPath = resolve(
    root,
    argValue(args, 'out') ??
      'tools/eval/conversation/annotations/worksheet.jsonl',
  );
  const maxTurns = Number(argValue(args, 'max-turns-per-case') ?? 2);
  const includeDrill = args.includes('--include-drill');

  const selection = readSelection(datasetPath).filter(
    (row) => includeDrill || row.source !== 'drill',
  );
  const rows: Array<Record<string, unknown>> = [];

  for (const item of selection) {
    const messages = await prisma.chatMessage.findMany({
      where: { conversationId: item.conversationId },
      orderBy: { seqId: 'asc' },
      select: {
        id: true,
        content: true,
        source: true,
        createdAt: true,
        triggerMessageId: true,
      },
    });

    const turns = pairTurns(
      messages.map((message) => ({
        id: message.id,
        role: roleOf(message.source),
        content: message.content ?? '',
        createdAt: message.createdAt,
        triggerMessageId: message.triggerMessageId,
      })),
    ).filter((turn) => turn.ai);

    for (const turn of turns.slice(0, maxTurns)) {
      rows.push({
        caseId: item.id,
        conversationId: item.conversationId,
        turn: turn.turn,
        source: item.source,
        language: item.language,
        intent: item.intent,
        question: turn.user.content.slice(0, 1000),
        answer: (turn.ai?.content ?? '').slice(0, 2000),
        labels: {
          correctness: null,
          helpfulness: null,
          tone_safety: null,
          comment: '',
        },
      });
    }
  }

  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(
    outPath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );
  console.log(
    `[annotate] cases=${selection.length} rows=${rows.length} out=${outPath}`,
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
