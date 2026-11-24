import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { SystemMessage } from '@langchain/core/messages';
import {
  createLLM,
  LlmProviderConfig,
} from '@api/client/ai-customer/graph/llm-factory';
import { RagService } from './rag.service';
import {
  buildJudgeInput,
  classifyJudgeError,
  JudgeErrorKind,
  JudgeSource,
  JudgeSpecVersion,
  resolveJudgeDocIds,
  resolveJudgeSpecVersion,
} from './judge-input-spec';

export type { JudgeSource };

/** 单次判官尝试。`faithful: null` 表示这次尝试失败（见 errorKind）。 */
export interface FaithfulnessAttempt {
  faithful: boolean | null;
  score: number | null;
  reason: string;
  unsupportedClaims?: string[];
  error?: string;
  errorKind?: JudgeErrorKind;
}

export interface FaithfulnessResult {
  /** null 表示「判官没能给出判定」，与 `faithful:false`（回答有错）不是一回事。 */
  faithful: boolean | null;
  score: number | null;
  unsupportedClaims: string[];
  reason: string;
  error?: string;
  /** 仅 `faithful === null` 时出现：判官失败或该用例不判答案准确性。 */
  errorKind?: JudgeErrorKind;
  judgeInputHash?: string;
  judgeSpecVersion: JudgeSpecVersion;
  /** 判官提示词版本：输入口径之外的第二个可变量，改动必须升版本。 */
  judgePromptVersion: string;
  /** 实际送审判官的来源条数（服务端解析后）。 */
  sourceCount: number;
  /** 本次实际发起的判定次数（1/3/5）。 */
  judgeRepeats?: number;
  /** 逐次判定明细，供审计与离线复盘。 */
  judgeAttempts?: FaithfulnessAttempt[];
  /** 成功判定的次数（返回了可解析的 faithful 布尔值）。 */
  judgeSuccessfulAttempts?: number;
  /** 多数阵营票数 / 成功次数；全部失败时为 0。 */
  judgeAgreement?: number;
  /** 平票或成功次数不足：记为 judge_error，不混入回答错误。 */
  judgeDisagreement?: boolean;
  /** 成功次数 < 2（N=1 也会标 true）：该用例不计入稳定性分母。 */
  judgeLowAttempts?: boolean;
}

export interface FaithfulnessJudgeParams {
  question: string;
  answer: string;
  /** 传了就按传入的 sources 判（兼容旧调用方）。 */
  sources?: JudgeSource[];
  /** 没传 sources 时，按 golden 文档 docId 取 chunk。 */
  expectedDocIds?: string[];
  /** 没传 sources 时，按回答实际引用的 docId 取 chunk。 */
  citedDocIds?: string[];
  /** 重复判定次数；不传读 EVAL_JUDGE_REPEATS，默认 3。 */
  repeats?: number;
}

const MAX_JUDGE_DOCS = 10;

/** 只接受奇数，保证成功判定之间总有多数票。 */
export const JUDGE_REPEAT_OPTIONS = [1, 3, 5] as const;
const DEFAULT_JUDGE_REPEATS = 3;

/**
 * 判官提示词版本。
 *
 * 2026-11-24 人工抽检发现旧提示词只查「关键词是否出现」，会把错误归属
 * （把别的章节的路径/规则安到当前说法上）和自行补充的例子判成有据；
 * strict-v1 增加上下文、归属与例子三条硬约束。
 */
export const JUDGE_PROMPT_VERSION = 'strict-v1';

const JUDGE_SYSTEM_PROMPT = `You are a strict RAG faithfulness judge.
Given a question, an answer, and retrieved sources, decide whether every factual claim
in the answer is supported by the sources.
Return ONLY a JSON object:
{"faithful": true|false, "score": 0.0-1.0, "unsupportedClaims": ["..."], "reason": "..."}
Rules:
- Use ONLY the sources; no outside knowledge.
- A claim is supported only when a source states it for the same subject, scope and context.
  Do not assemble a claim from fragments in different sections.
- If the answer attributes a rule, step, path or policy to a document or section that does
  not state it, mark it unsupported—even if similar words appear elsewhere in the sources.
- Examples or specifics added by the answer (for example extra events or extra timeframes)
  are unsupported unless the sources state them.
- If a number, date, fee, or policy is not in the sources, mark it unsupported.
- score=1 only when every factual claim is supported; 0 when the answer contradicts or invents facts.
- unsupportedClaims must be short quotes/phrases from the answer.
- reason must name the source sentence, or its absence, for each unsupported claim.`;

/** 解析 judge 输出；容忍 markdown code fence，非法输出返回 null。 */
export function parseJudgeOutput(
  raw: string,
): Pick<
  FaithfulnessResult,
  'faithful' | 'score' | 'unsupportedClaims' | 'reason'
> | null {
  const stripped = String(raw ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) return null;

  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (typeof parsed.faithful !== 'boolean') return null;

    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(1, rawScore))
      : parsed.faithful
        ? 1
        : 0;

    const unsupportedClaims = Array.isArray(parsed.unsupportedClaims)
      ? parsed.unsupportedClaims
          .filter((claim: unknown) => typeof claim === 'string')
          .slice(0, 10)
      : [];

    return {
      faithful: parsed.faithful,
      score: Number(score.toFixed(2)),
      unsupportedClaims,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return null;
  }
}

@Injectable()
export class RagFaithfulnessService {
  private readonly logger = new Logger(RagFaithfulnessService.name);
  private readonly chain;

  constructor(
    private readonly configService: ConfigService,
    private readonly ragService: RagService,
  ) {
    const llmConfig: LlmProviderConfig = {
      type: this.configService.get<'online' | 'local'>('AI_LLM_TYPE', 'local'),
      model: this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:0.8b'),
      baseURL: this.configService.get<string>(
        'AI_OLLAMA_BASE_URL',
        'http://localhost:11434',
      ),
      apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
    };

    const prompt = ChatPromptTemplate.fromMessages([
      // 用 SystemMessage 实例而不是模板字符串：
      // prompt 里的 JSON 花括号会被 ChatPromptTemplate 当成变量占位符。
      new SystemMessage(JUDGE_SYSTEM_PROMPT),
      ['human', '{input}'],
    ]);
    this.chain = prompt
      .pipe(createLLM(llmConfig, { temperature: 0 }))
      .pipe(new StringOutputParser());
  }

  async judge(params: FaithfulnessJudgeParams): Promise<FaithfulnessResult> {
    const specVersion = resolveJudgeSpecVersion(
      this.configService.get<string>('EVAL_JUDGE_SPEC'),
    );
    const sources = await this.resolveSources(params);
    if (sources.length === 0) {
      return {
        faithful: null,
        score: null,
        unsupportedClaims: [],
        reason: 'no_sources',
        errorKind: 'not_applicable',
        judgeSpecVersion: specVersion,
        judgePromptVersion: JUDGE_PROMPT_VERSION,
        sourceCount: 0,
      };
    }

    const judgeInput = buildJudgeInput({
      question: params.question,
      answer: params.answer,
      sources,
      expectedDocIds: params.expectedDocIds,
      citedDocIds: params.citedDocIds,
      specVersion,
    });

    const repeats = this.resolveJudgeRepeats(params.repeats);
    // 并行发起同一输入的 N 次判定；聚合只在这里做一次，在线/离线共用。
    const attempts = await Promise.all(
      Array.from({ length: repeats }, () =>
        this.runJudgeAttempt(judgeInput.input),
      ),
    );

    return this.aggregateAttempts(attempts, {
      repeats,
      judgeInputHash: judgeInput.judgeInputHash,
      judgeSpecVersion: specVersion,
      sourceCount: judgeInput.sourceCount,
    });
  }

  /** 解析重复次数：显式传入 > EVAL_JUDGE_REPEATS > 默认 3；非法值告警后回落。 */
  private resolveJudgeRepeats(requested?: number): number {
    if (requested !== undefined) {
      if ((JUDGE_REPEAT_OPTIONS as readonly number[]).includes(requested)) {
        return requested;
      }
      this.logger.warn(
        `[faithfulness] repeats=${String(requested)} not allowed (1/3/5), falling back to ${DEFAULT_JUDGE_REPEATS}`,
      );
      return DEFAULT_JUDGE_REPEATS;
    }

    const raw = this.configService.get<string | number>('EVAL_JUDGE_REPEATS');
    if (raw === undefined || raw === null || raw === '') {
      return DEFAULT_JUDGE_REPEATS;
    }
    const parsed = Number(raw);
    if ((JUDGE_REPEAT_OPTIONS as readonly number[]).includes(parsed)) {
      return parsed;
    }
    this.logger.warn(
      `[faithfulness] EVAL_JUDGE_REPEATS=${String(raw)} not allowed (1/3/5), falling back to ${DEFAULT_JUDGE_REPEATS}`,
    );
    return DEFAULT_JUDGE_REPEATS;
  }

  /** 单次判定：把解析失败与调用异常都收敛为一次「失败尝试」，不中断其它并行判定。 */
  private async runJudgeAttempt(input: string): Promise<FaithfulnessAttempt> {
    try {
      const raw = await this.chain.invoke({ input });
      const parsed = parseJudgeOutput(raw);
      if (!parsed) {
        this.logger.warn('[faithfulness] judge output is not valid JSON');
        return {
          faithful: null,
          score: null,
          reason: 'judge_parse_failed',
          error: String(raw).slice(0, 500),
          errorKind: 'output_format',
        };
      }
      return parsed;
    } catch (err) {
      this.logger.warn(
        `[faithfulness] judge call failed: ${(err as Error)?.message ?? err}`,
      );
      return {
        faithful: null,
        score: null,
        reason: 'judge_error',
        error: String((err as Error)?.message ?? err).slice(0, 500),
        errorKind: classifyJudgeError(err),
      };
    }
  }

  /**
   * 多数聚合。
   *
   * - 成功 0 次：沿用失败分类，judge_error；
   * - 成功不足 2 次（N>1）：判官_error + judge_disagreement，保留逐次错误类型；
   * - 平票：同上，但 errorKind 取首个失败类型（没有失败则 output_format）；
   * - 否则取多数阵营的首次结果。N=1 成功时等价旧行为。
   */
  private aggregateAttempts(
    attempts: FaithfulnessAttempt[],
    base: {
      repeats: number;
      judgeInputHash: string;
      judgeSpecVersion: JudgeSpecVersion;
      sourceCount: number;
    },
  ): FaithfulnessResult {
    const successes = attempts.filter(
      (attempt): attempt is FaithfulnessAttempt & { faithful: boolean } =>
        attempt.faithful !== null,
    );
    const failures = attempts.filter((attempt) => attempt.faithful === null);
    const trueVotes = successes.filter((attempt) => attempt.faithful).length;
    const falseVotes = successes.length - trueVotes;
    const majority =
      trueVotes > falseVotes ? true : falseVotes > trueVotes ? false : null;
    const judgeAgreement =
      successes.length > 0
        ? Math.round((Math.max(trueVotes, falseVotes) / successes.length) * 100) /
          100
        : 0;

    const common = {
      judgeInputHash: base.judgeInputHash,
      judgeSpecVersion: base.judgeSpecVersion,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      sourceCount: base.sourceCount,
      judgeRepeats: base.repeats,
      judgeAttempts: attempts,
      judgeSuccessfulAttempts: successes.length,
      judgeAgreement,
      judgeLowAttempts: successes.length < 2,
    };

    if (successes.length === 0) {
      const first = failures[0];
      return {
        ...common,
        faithful: null,
        score: null,
        unsupportedClaims: [],
        reason: 'judge_error',
        error: first?.error,
        errorKind: first?.errorKind ?? 'output_format',
        judgeDisagreement: false,
      };
    }

    if (base.repeats > 1 && successes.length < 2) {
      return {
        ...common,
        faithful: null,
        score: null,
        unsupportedClaims: [],
        reason: 'judge_disagreement',
        error: failures[0]?.error,
        errorKind: failures[0]?.errorKind ?? 'output_format',
        judgeDisagreement: true,
      };
    }

    if (majority === null) {
      return {
        ...common,
        faithful: null,
        score: null,
        unsupportedClaims: [],
        reason: 'judge_disagreement',
        error: failures[0]?.error,
        errorKind: failures[0]?.errorKind ?? 'output_format',
        judgeDisagreement: true,
      };
    }

    const winner = successes.find((attempt) => attempt.faithful === majority)!;
    return {
      ...common,
      faithful: winner.faithful,
      score: winner.score,
      unsupportedClaims: winner.unsupportedClaims ?? [],
      reason: winner.reason,
      judgeDisagreement: false,
    };
  }

  /**
   * 来源解析：传了 sources 就用传入的；否则按 docId 取 chunk。
   * docId 去重并限流（最多 10 篇），避免一次判官调用扫全库。
   */
  private async resolveSources(
    params: FaithfulnessJudgeParams,
  ): Promise<JudgeSource[]> {
    if (Array.isArray(params.sources) && params.sources.length > 0) {
      return params.sources;
    }

    const docIds = resolveJudgeDocIds(
      params.expectedDocIds,
      params.citedDocIds,
      MAX_JUDGE_DOCS,
    );

    const sources: JudgeSource[] = [];
    for (const docId of docIds) {
      const chunks = await this.ragService
        .getChunksByDocId(docId)
        .catch(() => []);
      for (const chunk of chunks) {
        sources.push({
          title: chunk.title,
          docId: chunk.docId,
          content: chunk.content,
        });
      }
    }
    return sources;
  }
}
