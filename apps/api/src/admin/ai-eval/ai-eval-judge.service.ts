import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { firstApiKey, parseApiKeys } from '@api/common/utils/api-keys';
import { captureJudgeRawOutput } from '@api/common/ai/judge-raw-output';
import {
  rawOutputText,
  structuredOutputEnabled,
  TASK_JUDGE_SCHEMA,
} from '@api/common/ai/judge-structured-output';
import {
  LlmUsageCollector,
  LlmUsageSnapshot,
} from '@api/common/ai/usage-collector';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { classifyJudgeError } from '@api/admin/rag/judge-input-spec';
import { JudgeErrorKind } from './dto/external-eval.dto';
import {
  JUDGE_DEFAULT_BASE_URL,
  JUDGE_DEFAULT_MODEL,
  JUDGE_PROMPT_HASH,
  JUDGE_SAMPLE_COUNT,
  JUDGE_SPEC_VERSION,
  JUDGE_SYSTEM_PROMPT,
  JudgeSpecSnapshot,
} from './judge-spec';

export type TaskVerdict = 'solved' | 'partial' | 'unsolved';

export interface TaskExpectation {
  /** 回答必须提到的关键信息（全部满足） */
  mustMention?: string[];
  /** 必须生成的确认动作，如 claim_coupon / create_address */
  confirmAction?: string;
  /** 明确禁止执行的动作（写工具只出卡片，不落库） */
  forbidExecution?: boolean;
  /** 期望的意图（可选，仅作 judge 上下文） */
  intent?: string;
}

export interface TaskJudgeInput {
  question: string;
  answer: string;
  expectTask: TaskExpectation;
  /** 写操作场景下 orchestrator 生成的确认卡片 */
  pendingConfirm?: Record<string, any> | null;
}

export interface TaskJudgeResult {
  verdict: TaskVerdict;
  score: number;
  reason: string;
  judgeModel: string;
  judgeVendor: string;
  /** judge 是否与被测模型（DeepSeek）不同厂商 */
  vendorIndependent: boolean;
  /** 截断后的原始输出，供留痕复盘。 */
  rawOutput?: string | null;
  rawTruncated?: boolean;
  /** 本次判定（含密钥轮换的失败尝试）的真实用量。 */
  usage?: LlmUsageSnapshot;
}

/**
 * 判官没能给出判定（格式不可解析等）。调用方据此记 `judge_error`，
 * 绝不能把它当成 `unsolved` —— 那会把判官故障算进回答错误率。
 *
 * 原始输出挂在异常字段上而不是拼进 message：message 会进日志与
 * 错误响应，原文可能含个人信息。
 */
export class JudgeFailureError extends Error {
  constructor(
    readonly kind: JudgeErrorKind,
    message: string,
    readonly rawOutput: string | null = null,
    readonly rawTruncated = false,
  ) {
    super(message);
    this.name = 'JudgeFailureError';
  }
}

export interface ParsedTaskVerdict {
  verdict: TaskVerdict;
  score: number;
  reason: string;
}

/**
 * 把已解析成对象的结果收敛到统一形状；文本解析与结构化解析共用。
 */
export function normalizeTaskVerdict(value: unknown): ParsedTaskVerdict | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Record<string, unknown>;
  if (
    parsed.verdict !== 'solved' &&
    parsed.verdict !== 'partial' &&
    parsed.verdict !== 'unsolved'
  ) {
    return null;
  }
  const score = Number(parsed.score);
  return {
    verdict: parsed.verdict,
    score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
  };
}

/** 从模型输出里解析 JSON；容忍 ```json 代码块。解析失败返回 null。 */
export function parseJudgeOutput(
  raw: string,
): Omit<
  TaskJudgeResult,
  'judgeModel' | 'judgeVendor' | 'vendorIndependent'
> | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return normalizeTaskVerdict(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 供应商粗分类：用于保证 judge 与被测模型不同厂商。 */
export function vendorOf(model: string, baseURL = ''): string {
  const s = `${model} ${baseURL}`.toLowerCase();
  if (s.includes('deepseek')) return 'deepseek';
  if (s.includes('groq') || s.includes('llama')) return 'groq';
  if (s.includes('gemini') || s.includes('googleapis')) return 'google';
  if (s.includes('anthropic') || s.includes('claude')) return 'anthropic';
  if (s.includes('openai')) return 'openai';
  return 'unknown';
}

/** 被测模型（客服主链路）当前固定为 DeepSeek。 */
export function assertIndependentVendor(config: LlmProviderConfig): void {
  if (vendorOf(config.model, config.baseURL) === 'deepseek') {
    throw new Error(
      'AI eval judge must use a different vendor than the chat model (deepseek)',
    );
  }
}

/** 是否允许 judge 与被测模型同厂商。生产默认禁止；本地评测可显式打开。 */
export function allowSameVendor(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.AI_EVAL_JUDGE_ALLOW_SAME_VENDOR === 'true' ||
    env.NODE_ENV === 'development'
  );
}

/**
 * 解析 judge 配置。
 * - 默认：Groq（不同厂商）
 * - AI_EVAL_JUDGE_ALLOW_SAME_VENDOR=true 或 NODE_ENV=development：DeepSeek 同厂judge
 *   （报告里会标 vendorIndependent=false，不能当作正式校准结论）
 */
export function resolveJudgeConfig(
  configService: ConfigService,
  env: Record<string, string | undefined> = process.env,
): LlmProviderConfig {
  if (allowSameVendor(env)) {
    return {
      type: 'online',
      model: configService.get<string>(
        'AI_EVAL_JUDGE_SAME_MODEL',
        'deepseek-chat',
      ),
      baseURL: configService.get<string>(
        'AI_EVAL_JUDGE_SAME_BASE_URL',
        'https://api.deepseek.com',
      ),
      apiKey: configService.get<string>('DEEPSEEK_API_KEY'),
    };
  }
  return {
    type: 'online',
    model: configService.get<string>(
      'AI_EVAL_JUDGE_MODEL',
      JUDGE_DEFAULT_MODEL,
    ),
    baseURL: configService.get<string>(
      'AI_EVAL_JUDGE_BASE_URL',
      JUDGE_DEFAULT_BASE_URL,
    ),
    apiKey: firstApiKey(configService.get<string>('GROQ_API_KEY')),
  };
}

/** judge 链调用可接收的回调配置（用量采集挂载点）。 */
interface JudgeInvokeConfig {
  callbacks?: unknown[];
}

type StructuredJudgeChain = {
  invoke(
    input: { input: string },
    config?: JudgeInvokeConfig,
  ): Promise<{
    raw?: unknown;
    parsed?: unknown;
  }>;
};

@Injectable()
export class AiEvalJudgeService {
  private readonly logger = new Logger(AiEvalJudgeService.name);
  private readonly judgeModel: string;
  private readonly judgeVendor: string;
  private readonly vendorIndependent: boolean;
  private readonly config: LlmProviderConfig;
  private readonly apiKeys: string[];
  private readonly prompt: ChatPromptTemplate;
  private readonly structuredEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const config = resolveJudgeConfig(configService);
    this.config = config;
    this.judgeModel = config.model;
    this.judgeVendor = vendorOf(config.model, config.baseURL);
    this.vendorIndependent = this.judgeVendor !== 'deepseek';
    const rawKeys = this.vendorIndependent
      ? configService.get<string>('GROQ_API_KEY')
      : configService.get<string>('DEEPSEEK_API_KEY');
    const keys = parseApiKeys(rawKeys);
    this.apiKeys =
      keys.length > 0
        ? keys
        : firstApiKey(config.apiKey)
          ? [config.apiKey as string]
          : [];
    if (this.vendorIndependent) {
      assertIndependentVendor(config);
    } else if (!allowSameVendor()) {
      throw new Error(
        'AI eval judge must use a different vendor than the chat model (deepseek). ' +
          'Set AI_EVAL_JUDGE_ALLOW_SAME_VENDOR=true only for local calibration.',
      );
    }

    this.prompt = ChatPromptTemplate.fromMessages([
      // 用 SystemMessage 实例：prompt 里的 JSON 花括号会被当成模板变量。
      new SystemMessage(JUDGE_SYSTEM_PROMPT),
      ['human', '{input}'],
    ]);
    this.structuredEnabled = structuredOutputEnabled(
      this.configService.get<string>('EVAL_JUDGE_STRUCTURED_OUTPUT'),
    );
  }

  /** 每次调用单独建链，便于按 key 轮换。 */
  private buildChain(apiKey: string) {
    return this.prompt
      .pipe(createLLM({ ...this.config, apiKey }, { temperature: 0 }))
      .pipe(new StringOutputParser());
  }

  /**
   * 结构化链同样按 key 构建：解码约束不能成为绕开密钥轮换的旁路。
   * 必须显式 jsonMode（非 gpt 模型默认 jsonSchema，DeepSeek 实测 400）。
   */
  private buildStructuredChain(apiKey: string): StructuredJudgeChain {
    return this.prompt.pipe(
      createLLM({ ...this.config, apiKey }, { temperature: 0 }).withStructuredOutput(
        TASK_JUDGE_SCHEMA,
        { method: 'jsonMode', includeRaw: true },
      ),
    ) as unknown as StructuredJudgeChain;
  }

  /**
   * 同一次尝试内取判官输出：结构化优先，提供方拒绝时用同一密钥降级文本链。
   * 换密钥是「调用失败」的策略，不用于解码降级。
   */
  private async invokeJudge(
    apiKey: string,
    input: string,
    usage: LlmUsageCollector,
  ): Promise<{ raw: string; parsed: ParsedTaskVerdict | null }> {
    const callbacks = [usage];
    if (this.structuredEnabled) {
      try {
        const result = await this.buildStructuredChain(apiKey).invoke(
          { input },
          { callbacks },
        );
        const raw = rawOutputText(result?.raw);
        const parsed = normalizeTaskVerdict(result?.parsed);
        if (!parsed) {
          this.logger.warn(
            '[task-judge] structured output rejected by schema, falling back to text parse',
          );
        }
        return { raw, parsed };
      } catch (err: any) {
        this.logger.warn(
          `[task-judge] structured judge call failed, falling back to text: ${err?.message ?? err}`,
        );
      }
    }

    const raw = await this.buildChain(apiKey).invoke({ input }, { callbacks });
    return { raw, parsed: null };
  }

  /**
   * 本次进程实际使用的判官身份（模型/供应商来自运行时配置，版本与 prompt
   * 指纹来自 judge-spec）。run 启动时快照这五项，历史数字才可归因。
   */
  spec(): JudgeSpecSnapshot {
    return {
      version: JUDGE_SPEC_VERSION,
      promptHash: JUDGE_PROMPT_HASH,
      model: this.judgeModel,
      vendor: this.judgeVendor,
      sampleCount: JUDGE_SAMPLE_COUNT,
    };
  }

  async judge(input: TaskJudgeInput): Promise<TaskJudgeResult> {
    if (this.apiKeys.length === 0) {
      throw new ServiceUnavailableException(
        `AI eval judge is not configured (${this.vendorIndependent ? 'GROQ_API_KEY' : 'DEEPSEEK_API_KEY'} missing)`,
      );
    }

    const judgeModel = this.judgeModel;
    const payload = {
      question: input.question,
      answer: input.answer.slice(0, 4000),
      expectTask: input.expectTask,
      pendingConfirm: input.pendingConfirm ?? null,
    };

    // 一次 judge() 共享一个 collector：密钥轮换的每次尝试都计入调用数。
    const usage = new LlmUsageCollector('judge');
    let lastError: unknown = null;
    for (let index = 0; index < this.apiKeys.length; index += 1) {
      try {
        const { raw, parsed } = await this.invokeJudge(
          this.apiKeys[index],
          JSON.stringify(payload),
          usage,
        );
        const captured = captureJudgeRawOutput(raw);
        const verdict = parsed ?? parseJudgeOutput(String(raw));
        if (!verdict) {
          this.logger.warn('[task-judge] judge output is not valid JSON');
          // 格式错误换 key 也不会变好：立即抛给调用方记 judge_error(output_format)，
          // 而不是返回 unsolved 把判官故障混进回答错误。
          throw new JudgeFailureError(
            'output_format',
            'AI eval judge output is not valid JSON',
            captured.rawOutput,
            captured.rawTruncated,
          );
        }
        return {
          ...verdict,
          ...captured,
          usage: usage.snapshot(),
          judgeModel,
          judgeVendor: this.judgeVendor,
          vendorIndependent: this.vendorIndependent,
        };
      } catch (err: any) {
        if (err instanceof JudgeFailureError) throw err;
        lastError = err;
        this.logger.warn(
          `[task-judge] key ${index + 1}/${this.apiKeys.length} failed: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.error(
      `[task-judge] judge call failed: ${(lastError as any)?.message ?? lastError}`,
    );
    // 保留 503（整单不可用），但把失败类别带进 body，调用方无需再猜错误文本。
    throw new ServiceUnavailableException({
      message: 'AI eval judge call failed',
      kind: classifyJudgeError(lastError),
    });
  }
}
