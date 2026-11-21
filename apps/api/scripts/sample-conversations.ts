/**
 * P4：从生产/本地会话中抽样，生成每日 selection JSONL（只读）。
 *
 * 用法（在 apps/api 下）：
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/sample-conversations.ts \
 *     --date 2026-11-21 --limit 30 --sources sim --seed 42
 *
 * 规则：
 * - 只取 SUPPORT 会话，窗口为 UTC [date, date+1)
 * - 排除 drill（死信演练/__CHAOS__）、空会话、少于 2 条消息
 * - 按 language × outcome 分层轮转抽样，seed 可复现
 * - sim 通过 conversation.aiMetadata.trafficSource 标记，默认只抽 real
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { detectLanguage } from '../src/admin/ai-eval/evaluators/deterministic';

const prisma = new PrismaClient();

interface Candidate {
  conversationId: string;
  source: 'real' | 'sim';
  language: 'zh' | 'en' | 'mixed';
  intent: string;
  outcome: 'success' | 'failure';
  messageCount: number;
  firstUser: string;
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function main() {
  const args = process.argv.slice(2);
  const date =
    argValue(args, 'date') ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const limit = Number(argValue(args, 'limit') ?? 30);
  const sources = (argValue(args, 'sources') ?? 'real')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const seed = Number(
    argValue(args, 'seed') ??
      [...date].reduce((sum, ch) => sum + ch.charCodeAt(0), 0),
  );
  const includeDrill = args.includes('--include-drill');
  const root = resolve(__dirname, '../../..');
  const outPath = resolve(
    root,
    argValue(args, 'out') ??
      `tools/eval/conversation/selection-daily-${date}.jsonl`,
  );

  const from = argValue(args, 'from');
  const to = argValue(args, 'to');
  const start = new Date(`${from ?? date}T00:00:00.000Z`);
  const end = to
    ? new Date(`${to}T00:00:00.000Z`)
    : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const versionDate = to ?? date;

  const conversations = await prisma.conversation.findMany({
    where: { type: 'SUPPORT', createdAt: { gte: start, lt: end } },
    select: {
      id: true,
      handlerId: true,
      aiMetadata: true,
      _count: { select: { messages: true } },
    },
  });
  const ids = conversations.map((row) => row.id);
  if (ids.length === 0) {
    console.log(`[sample] no SUPPORT conversations on ${date}`);
    return;
  }

  const [messages, drillRows, feedbackCounts, traces] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { conversationId: { in: ids } },
      orderBy: { seqId: 'asc' },
      select: { conversationId: true, content: true, source: true },
    }),
    prisma.chatMessage.findMany({
      where: {
        conversationId: { in: ids },
        OR: [
          { content: { contains: '死信演练' } },
          { content: { contains: '__CHAOS__' } },
        ],
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    }),
    prisma.aiAnswerFeedback.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.aiTrace.findMany({
      where: { conversationId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { conversationId: true, intent: true },
    }),
  ]);

  const drillIds = new Set(drillRows.map((row) => row.conversationId));
  const feedbackByConversation = new Map(
    feedbackCounts.map((row) => [row.conversationId, row._count._all]),
  );
  const intentByConversation = new Map<string, string>();
  for (const trace of traces) {
    if (!intentByConversation.has(trace.conversationId) && trace.intent) {
      intentByConversation.set(trace.conversationId, trace.intent);
    }
  }

  const firstUserByConversation = new Map<string, string>();
  const messageCountByConversation = new Map<string, number>();
  for (const message of messages) {
    messageCountByConversation.set(
      message.conversationId,
      (messageCountByConversation.get(message.conversationId) ?? 0) + 1,
    );
    if (
      message.source === 'user' &&
      !firstUserByConversation.has(message.conversationId)
    ) {
      firstUserByConversation.set(
        message.conversationId,
        message.content ?? '',
      );
    }
  }

  const candidates: Candidate[] = [];
  const seenFirstUser = new Set<string>();
  for (const conversation of conversations) {
    const messageCount =
      messageCountByConversation.get(conversation.id) ??
      conversation._count.messages;
    if (messageCount < 2) continue;
    if (!includeDrill && drillIds.has(conversation.id)) continue;

    const firstUser = firstUserByConversation.get(conversation.id) ?? '';
    if (!firstUser.trim()) continue;
    const dedupeKey = firstUser.replace(/\s+/g, '').toLowerCase();
    if (seenFirstUser.has(dedupeKey)) continue;
    seenFirstUser.add(dedupeKey);

    const rawIntent = intentByConversation.get(conversation.id) ?? 'general';
    const intent =
      rawIntent === 'lucky-draw' ? 'lucky' : rawIntent;
    const allowedIntents = [
      'order',
      'wallet',
      'coupon',
      'product',
      'user',
      'kyc',
      'lucky',
      'rag',
      'general',
    ];
    const normalizedIntent = allowedIntents.includes(intent) ? intent : 'general';

    const metadata = (conversation.aiMetadata ?? {}) as Record<string, unknown>;
    const source: Candidate['source'] =
      metadata.trafficSource === 'simulation_support_v1' ? 'sim' : 'real';
    if (!sources.includes(source)) continue;

    const language = detectLanguage(firstUser);
    if (language === 'unknown') continue;

    const hasFeedback = (feedbackByConversation.get(conversation.id) ?? 0) > 0;
    const outcome: Candidate['outcome'] =
      conversation.handlerId === 'awaiting_human' || hasFeedback
        ? 'failure'
        : 'success';

    candidates.push({
      conversationId: conversation.id,
      source,
      language,
      intent: normalizedIntent,
      outcome,
      messageCount,
      firstUser,
    });
  }

  if (candidates.length === 0) {
    console.log(
      `[sample] no eligible conversations on ${date} (sources=${sources.join(',')}, drill=${includeDrill})`,
    );
    return;
  }

  const random = mulberry32(seed);
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.language}|${candidate.outcome}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const groupKeys = [...groups.keys()].sort();
  for (const key of groupKeys) {
    groups.set(key, shuffle(groups.get(key) ?? [], random));
  }

  const strataSummary = groupKeys
    .map((key) => `${key}:${(groups.get(key) ?? []).length}`)
    .join(', ');

  const selected: Candidate[] = [];
  let cursor = 0;
  while (selected.length < Math.min(limit, candidates.length)) {
    const key = groupKeys[cursor % groupKeys.length];
    const bucket = groups.get(key) ?? [];
    if (bucket.length > 0) selected.push(bucket.shift()!);
    cursor += 1;
    if (groupKeys.every((item) => (groups.get(item) ?? []).length === 0)) break;
  }

  const datasetVersion = `${versionDate}.1`;
  const usedIds = new Set<string>();
  const rows = selected.map((candidate, index) => {
    let id = `conv-${candidate.conversationId.slice(0, 10)}`;
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    return {
      id,
      datasetVersion,
      conversationId: candidate.conversationId,
      source: candidate.source,
      language: candidate.language,
      intent: candidate.intent,
      tags: ['daily', candidate.outcome, `msgs-${candidate.messageCount}`],
    };
  });

  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(
    outPath,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );

  console.log(
    `[sample] date=${date} candidates=${candidates.length} selected=${rows.length} seed=${seed}`,
  );
  console.log(`[sample] strata=${strataSummary}`);
  console.log(`[sample] out=${outPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
