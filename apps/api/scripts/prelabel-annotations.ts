/**
 * AI 预标注（不是 ground truth）。
 *
 * 读取人工工作表，用不同厂商的 judge 生成草稿标签，写出 annotations-ai.jsonl。
 * 人审后只使用人工标签算 kappa；AI 标签只做参考与分歧发现。
 *
 * 用法（apps/api 下）：
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/prelabel-annotations.ts \
 *     --worksheet tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl \
 *     --out tools/eval/conversation/annotations/annotations-ai.jsonl
 *
 * 常用参数：--limit=N --dry-run --resume --force --delay-ms=200
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLLM } from '../src/client/ai-customer/graph/llm-factory';
import {
  buildPrelabelMessages,
  parsePrelabelOutput,
  vendorOf,
  type PrelabelResult,
} from '../src/admin/ai-eval/prelabel/prelabel';
import { parseApiKeys } from '../src/common/utils/api-keys';

interface WorksheetRow {
  caseId: string;
  turn: number;
  intent?: string;
  language?: string;
  question: string;
  answer: string;
  labels?: Record<string, unknown>;
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function keyOf(row: { caseId: string; turn: number }): string {
  return `${row.caseId}#${row.turn}`;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(__dirname, '../../..');
  const worksheetPath = resolve(
    root,
    argValue(args, 'worksheet') ??
      'tools/eval/conversation/annotations/worksheet-2026-11-21.jsonl',
  );
  const outPath = resolve(
    root,
    argValue(args, 'out') ??
      'tools/eval/conversation/annotations/annotations-ai.jsonl',
  );
  const limit = Number(argValue(args, 'limit') ?? 0);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const resume = args.includes('--resume');
  const delayMs = Number(argValue(args, 'delay-ms') ?? 200);

  if (!existsSync(worksheetPath)) {
    throw new Error(`worksheet not found: ${worksheetPath}`);
  }

  const explicitModel = process.env.AI_PRELABEL_MODEL;
  const preferredModels = explicitModel
    ? [explicitModel]
    : [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'gemma2-9b-it',
      ];
  const baseURL =
    process.env.AI_PRELABEL_BASE_URL ?? 'https://api.groq.com/openai/v1';
  const allowSameVendor =
    process.env.AI_PRELABEL_ALLOW_SAME_VENDOR === 'true';
  const rawKey =
    process.env.AI_PRELABEL_API_KEY ??
    process.env.GROQ_API_KEY ??
    (allowSameVendor ? process.env.DEEPSEEK_API_KEY : '') ??
    '';
  const apiKeys = parseApiKeys(rawKey);
  if (apiKeys.length === 0 && !dryRun) {
    throw new Error(
      'Missing judge API key: set AI_PRELABEL_API_KEY or GROQ_API_KEY (or use --dry-run)',
    );
  }

  const rows = readFileSync(worksheetPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as WorksheetRow);

  const existing = new Map<string, Record<string, unknown>>();
  if (resume && existsSync(outPath)) {
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown> & {
        caseId: string;
        turn: number;
      };
      existing.set(keyOf(row), row);
    }
  }

  // 多 key 时先探活：401/403 跳过，其他状态/网络错误先用第一把。
  // 不打印 key 本身，只打印序号。
  async function pickApiKey(): Promise<{
    key: string;
    index: number;
    modelIds: string[];
  } | null> {
    if (dryRun) return null;
    for (let index = 0; index < apiKeys.length; index += 1) {
      const key = apiKeys[index];
      try {
        const response = await fetch(
          `${baseURL.replace(/\/$/, '')}/models`,
          {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (response.status === 401 || response.status === 403) continue;
        const body = (await response.json().catch(() => ({}))) as {
          data?: Array<{ id?: string }>;
        };
        const modelIds = Array.isArray(body.data)
          ? body.data
              .map((item) => item.id)
              .filter((id): id is string => !!id)
          : [];
        console.log(
          `[prelabel] using key ${index + 1}/${apiKeys.length} (status=${response.status}, models=${modelIds.length})`,
        );
        return { key, index, modelIds };
      } catch {
        // 网络不可达时不要误杀 key，交给真正的 invoke 决定。
        console.warn(
          `[prelabel] key ${index + 1} preflight network error, will try it`,
        );
        return { key, index, modelIds: [] };
      }
    }
    return null;
  }

  const selected = await pickApiKey();
  if (!dryRun && !selected) {
    throw new Error(
      'No usable judge API key: all keys returned 401/403. Rotate the key or check GROQ_API_KEY.',
    );
  }

  const model = dryRun
    ? (explicitModel ?? preferredModels[0])
    : (preferredModels.find((id) => selected!.modelIds.includes(id)) ??
      preferredModels[0]);

  if (selected && explicitModel && !selected.modelIds.includes(explicitModel)) {
    console.warn(
      `[prelabel] configured model ${explicitModel} is not available to this key; using ${model}`,
    );
  }
  console.log(`[prelabel] using model ${model}`);

  const vendorIndependent = vendorOf(model, baseURL) !== 'deepseek';
  if (!vendorIndependent && !allowSameVendor) {
    throw new Error(
      'AI prelabel judge must use a different vendor from the chat model (deepseek); set AI_PRELABEL_ALLOW_SAME_VENDOR=true only for local experiments',
    );
  }
  const judgeVersion =
    process.env.AI_PRELABEL_VERSION ??
    `${model}@${new Date().toISOString().slice(0, 10)}`;

  const llm = dryRun
    ? null
    : createLLM(
        {
          type: 'online',
          model,
          baseURL,
          apiKey: selected!.key,
        },
        { temperature: 0 },
      );

  let processed = 0;
  let skipped = 0;
  let ok = 0;
  let abstain = 0;
  let invalid = 0;
  let errors = 0;
  const output: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (limit > 0 && processed >= limit) break;
    const key = keyOf(row);
    if (!force && existing.has(key)) {
      const previous = existing.get(key)!;
      const status = (previous.prelabel as { status?: string } | undefined)
        ?.status;
      // 只跳过成功/弃权行；error/invalid 允许 --resume 重试。
      if (status === 'ok' || status === 'abstain') {
        output.push(previous);
        skipped += 1;
        continue;
      }
    }

    const messages = buildPrelabelMessages({
      question: row.question,
      answer: row.answer,
      intent: row.intent,
      language: row.language,
    });

    if (dryRun) {
      console.log(`[prelabel] dry-run ${key}`);
      console.log(`  promptChars=${messages.reduce((sum, m) => sum + m.content.length, 0)}`);
      processed += 1;
      continue;
    }

    let parsed: PrelabelResult | null = null;
    let status = 'ok';
    let errorText: string | null = null;
    try {
      const response = await llm!.invoke(messages as any);
      parsed = parsePrelabelOutput(extractText(response.content));
      if (!parsed) status = 'invalid';
      else if (parsed.correctness === 'abstain') status = 'abstain';
    } catch (error: any) {
      status = 'error';
      errorText = String(error?.message ?? error).slice(0, 200);
    }

    const next = {
      ...row,
      labels: {
        correctness: parsed?.correctness ?? null,
        helpfulness: parsed?.helpfulness ?? null,
        tone_safety: parsed?.tone_safety ?? null,
        comment: '',
      },
      prelabel: {
        source: 'LLM',
        judgeModel: model,
        judgeVersion,
        confidence: parsed?.confidence ?? 0,
        reason: parsed?.reason ?? errorText ?? '',
        status,
        vendorIndependent,
      },
    };

    output.push(next);
    processed += 1;
    if (status === 'ok') ok += 1;
    else if (status === 'abstain') abstain += 1;
    else if (status === 'invalid') invalid += 1;
    else errors += 1;

    console.log(
      `[prelabel] ${key} ${status}${parsed ? ` correctness=${parsed.correctness} conf=${parsed.confidence}` : ''}`,
    );
    if (delayMs > 0) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));
    }
  }

  if (dryRun) {
    console.log(
      `[prelabel] dry-run done: rows=${rows.length}, processed=${processed}, existing=${existing.size}`,
    );
    return;
  }

  mkdirSync(resolve(outPath, '..'), { recursive: true });
  writeFileSync(
    outPath,
    `${output.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );

  console.log(
    `[prelabel] done: processed=${processed}, skipped=${skipped}, ok=${ok}, abstain=${abstain}, invalid=${invalid}, error=${errors}`,
  );
  console.log(`[prelabel] out=${outPath}`);
  console.log(
    '[prelabel] 提醒：这是草稿标签，不能当 ground truth，也不能单独用于 kappa。',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
