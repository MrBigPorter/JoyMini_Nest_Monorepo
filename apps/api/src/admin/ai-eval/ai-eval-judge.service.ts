import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { firstApiKey } from '@api/common/utils/api-keys';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';

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
}

const JUDGE_SYSTEM_PROMPT = `你是 AI 客服任务完成度的严格评审员。
只依据给出的「用户问题」「AI 回答」「期望任务」「确认卡片」判断，不引入外部知识。

判定标准：
- solved：回答了问题；expectTask.mustMention 中的关键信息全部出现；若期望确认动作，确认卡片存在且动作匹配；写操作没有被真实执行。
- partial：方向相关，但缺少关键信息、答案不完整或格式不对。
- unsolved：答非所问、拒绝回答、编造信息，或写操作被直接执行（没有确认卡片）。

只输出一个 JSON 对象，不要 markdown：
{"verdict":"solved|partial|unsolved","score":0.0-1.0,"reason":"不超过 80 字的中文理由"}`;

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
    const parsed = JSON.parse(text);
    if (!['solved', 'partial', 'unsolved'].includes(parsed.verdict)) {
      return null;
    }
    const score = Number(parsed.score);
    return {
      verdict: parsed.verdict,
      score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0,
      reason:
        typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
    };
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
      'llama-3.3-70b-versatile',
    ),
    baseURL: configService.get<string>(
      'AI_EVAL_JUDGE_BASE_URL',
      'https://api.groq.com/openai/v1',
    ),
    apiKey: firstApiKey(configService.get<string>('GROQ_API_KEY')),
  };
}

@Injectable()
export class AiEvalJudgeService {
  private readonly logger = new Logger(AiEvalJudgeService.name);
  private readonly chain: any;
  private readonly judgeModel: string;
  private readonly judgeVendor: string;
  private readonly vendorIndependent: boolean;
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    const config = resolveJudgeConfig(configService);
    this.apiKey = config.apiKey;
    this.judgeModel = config.model;
    this.judgeVendor = vendorOf(config.model, config.baseURL);
    this.vendorIndependent = this.judgeVendor !== 'deepseek';
    if (this.vendorIndependent) {
      assertIndependentVendor(config);
    } else if (!allowSameVendor()) {
      throw new Error(
        'AI eval judge must use a different vendor than the chat model (deepseek). ' +
          'Set AI_EVAL_JUDGE_ALLOW_SAME_VENDOR=true only for local calibration.',
      );
    }

    const prompt = ChatPromptTemplate.fromMessages([
      // 用 SystemMessage 实例：prompt 里的 JSON 花括号会被当成模板变量。
      new SystemMessage(JUDGE_SYSTEM_PROMPT),
      ['human', '{input}'],
    ]);
    this.chain = prompt
      .pipe(createLLM(config, { temperature: 0 }))
      .pipe(new StringOutputParser());
  }

  async judge(input: TaskJudgeInput): Promise<TaskJudgeResult> {
    if (!this.apiKey) {
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

    try {
      const raw = await this.chain.invoke({
        input: JSON.stringify(payload),
      });
      const parsed = parseJudgeOutput(String(raw));
      if (!parsed) {
        this.logger.warn('[task-judge] judge output is not valid JSON');
        return {
          verdict: 'unsolved',
          score: 0,
          reason: 'judge_parse_failed',
          judgeModel,
          judgeVendor: this.judgeVendor,
          vendorIndependent: this.vendorIndependent,
        };
      }
      return {
        ...parsed,
        judgeModel,
        judgeVendor: this.judgeVendor,
        vendorIndependent: this.vendorIndependent,
      };
    } catch (err: any) {
      this.logger.error(
        `[task-judge] judge call failed: ${err?.message ?? err}`,
      );
      throw new ServiceUnavailableException('AI eval judge call failed');
    }
  }
}
