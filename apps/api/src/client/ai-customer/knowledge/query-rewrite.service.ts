import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createLLM } from '@api/client/ai-customer/graph/llm-factory';
import type { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import type { RedisService } from '@api/common/redis/redis.service';

/**
 * 查询改写 —— 让中文问句能命中英文知识库。
 *
 * ── 为什么需要它 ──
 * 知识库正文以英文为主，embedding 虽然多语，但中文口语问句和英文
 * 政策文档之间的语义距离仍然偏大（验收 Hit@3 只有 53.8%）。把问句
 * 先改写成英文短查询，再和原问句一起送进检索，是成本最低的补法。
 *
 * ── 边界 ──
 * - 只对含 CJK 的问句改写：英文问句原样检索，不做无谓调用。
 * - 改写失败/超时一律返回 null，调用方退回原问句，不阻塞回答。
 * - 结果按规范化问句哈希缓存 7 天，避免同一问题反复付费。
 */

const logger = new Logger('QueryRewrite');

export const REWRITE_CACHE_PREFIX = 'rag:rewrite:';
export const REWRITE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REWRITE_TIMEOUT_MS = 3_000;
export const MAX_REWRITE_CHARS = 200;

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

const REWRITE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You translate a customer-support question into a short English search query.',
      'Rules:',
      '- Output ONE line, no quotes, no explanation.',
      '- Keep product names, order numbers and amounts as they are.',
      '- If the question is already English, return it unchanged.',
      '- If the question is not a business question, return it unchanged.',
    ].join('\n'),
  ],
  ['human', '{question}'],
]);

export interface QueryRewriteDeps {
  /** 仅用于测试注入；缺省走真实 chat 模型。 */
  runModel?: (question: string) => Promise<string>;
}

export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

export function normalizeQuery(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildRewriteCacheKey(question: string): string {
  const digest = createHash('sha256')
    .update(normalizeQuery(question))
    .digest('hex')
    .slice(0, 32);
  return `${REWRITE_CACHE_PREFIX}${digest}`;
}

/** 模型输出清理：只留第一行、去掉包裹引号、限长。 */
export function sanitizeRewrite(raw: string, original: string): string | null {
  const firstLine = (raw ?? '').split(/\r?\n/)[0] ?? '';
  const cleaned = firstLine
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_REWRITE_CHARS) return null;
  if (normalizeQuery(cleaned) === normalizeQuery(original)) return null;
  return cleaned;
}

export class QueryRewriteService {
  private readonly runModel: (question: string) => Promise<string>;

  constructor(
    llmConfig: LlmProviderConfig,
    private readonly redisService?: RedisService,
    deps?: QueryRewriteDeps,
  ) {
    if (deps?.runModel) {
      this.runModel = deps.runModel;
    } else {
      const model = createLLM(llmConfig, { temperature: 0 });
      const chain = REWRITE_PROMPT.pipe(model).pipe(new StringOutputParser());
      this.runModel = async (question: string) =>
        String(await chain.invoke({ question }));
    }
  }

  /**
   * 返回英文改写；不需要改写或失败时返回 null。
   * 不抛异常：调用方永远可以用原问句继续检索。
   */
  async rewrite(question: string): Promise<string | null> {
    const input = question?.trim() ?? '';
    if (!input || !hasCjk(input)) return null;

    const cacheKey = buildRewriteCacheKey(input);
    try {
      const cached = await this.redisService?.get(cacheKey);
      if (cached) return cached;
    } catch (err: any) {
      // 缓存不可用不影响改写本身
      logger.debug(`[rewrite] cache read failed: ${err?.message ?? err}`);
    }

    let rewritten: string | null = null;
    try {
      const raw = await Promise.race([
        this.runModel(input),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error('rewrite_timeout')),
            REWRITE_TIMEOUT_MS,
          ).unref?.(),
        ),
      ]);
      rewritten = sanitizeRewrite(raw, input);
    } catch (err: any) {
      logger.debug(`[rewrite] model failed: ${err?.message ?? err}`);
      return null;
    }

    if (!rewritten) return null;

    try {
      await this.redisService?.set(
        cacheKey,
        rewritten,
        REWRITE_CACHE_TTL_SECONDS,
      );
    } catch (err: any) {
      logger.debug(`[rewrite] cache write failed: ${err?.message ?? err}`);
    }
    return rewritten;
  }
}
