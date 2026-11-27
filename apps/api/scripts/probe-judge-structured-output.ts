/**
 * 判官结构化输出能力探测（eval-ingestion-hardening 4.1）。
 *
 * 对 DeepSeek / Groq 各试两种取法：
 * - jsonMode：显式 response_format=json_object（宽松 JSON，不传 schema）
 * - jsonSchema：把 zod schema 交给 provider 严格校验（非 gpt 模型的默认取法）
 *
 * 输出只包含 provider / 取法 / 结果 / 错误码，不打印密钥与提示词。
 * 结论写入 openspec/changes/eval-ingestion-hardening/design.md。
 *
 * 用法（apps/api 下）：
 *   ../../node_modules/.bin/tsx --env-file=.env scripts/probe-judge-structured-output.ts
 */
import { z } from 'zod';
import { createLLM } from '../src/client/ai-customer/graph/llm-factory';

const schema = z.object({
  faithful: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string(),
});

const PROMPT =
  '只有一句来源：退款将在 7 个工作日内到账。回答：退款 7 个工作日内到账。' +
  '请判断回答是否被来源支持，只输出 JSON：{"faithful": bool, "score": 0-1, "reason": string}';

const PROVIDERS = [
  {
    name: 'deepseek',
    model: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  {
    name: 'groq',
    // 默认模型可能因账号权限不可用；用 AI_EVAL_JUDGE_MODEL 指定当前可访问的模型。
    model: process.env.AI_EVAL_JUDGE_MODEL ?? 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
  },
] as const;

const METHODS = ['jsonMode', 'jsonSchema'] as const;

/** 错误文本可能带请求 URL/头：把密钥与常见 key 形态一并抹掉再打印。 */
function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***');
  }
  return out.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').slice(0, 300);
}

function errorSummary(err: unknown, secrets: string[]): string {
  const anyErr = err as {
    status?: number;
    code?: string;
    message?: string;
    response?: { status?: number };
  };
  const status = anyErr?.status ?? anyErr?.response?.status;
  const parts = [
    status ? `HTTP ${status}` : null,
    anyErr?.code,
    anyErr?.message,
  ]
    .filter(Boolean)
    .join(' | ');
  return scrub(parts || String(err), secrets);
}

async function probe(
  provider: (typeof PROVIDERS)[number],
  method: (typeof METHODS)[number],
): Promise<{ ok: boolean; detail: string }> {
  const apiKey = process.env[provider.keyEnv]?.split(',')[0]?.trim();
  if (!apiKey) return { ok: false, detail: `missing ${provider.keyEnv}` };
  const secrets = [apiKey, ...(process.env[provider.keyEnv] ?? '').split(',')];

  try {
    const model = createLLM(
      {
        type: 'online',
        model: provider.model,
        baseURL: provider.baseURL,
        apiKey,
      },
      { temperature: 0 },
    );
    const structured = model.withStructuredOutput(schema, {
      method,
      includeRaw: true,
    });
    const result = await structured.invoke(PROMPT);
    const parsed = (result as { parsed?: unknown }).parsed;
    if (!parsed) {
      return { ok: false, detail: 'returned no parsed value' };
    }
    const typed = parsed as z.infer<typeof schema>;
    return {
      ok: true,
      detail: `faithful=${typed.faithful} score=${typed.score}`,
    };
  } catch (err) {
    return { ok: false, detail: errorSummary(err, secrets) };
  }
}

async function main(): Promise<void> {
  let failures = 0;
  for (const provider of PROVIDERS) {
    for (const method of METHODS) {
      const { ok, detail } = await probe(provider, method);
      if (ok) {
        console.log(
          `${provider.name.padEnd(8)} ${method.padEnd(10)} OK   ${detail}`,
        );
      } else {
        failures += 1;
        console.log(
          `${provider.name.padEnd(8)} ${method.padEnd(10)} FAIL ${detail}`,
        );
      }
    }
  }
  console.log(
    failures === 0
      ? 'RESULT: 两种取法在两家 provider 都可用'
      : `RESULT: ${failures} 个组合不可用（见上）`,
  );
}

main().catch((err) => {
  console.error(scrub(String(err), []));
  process.exitCode = 1;
});
