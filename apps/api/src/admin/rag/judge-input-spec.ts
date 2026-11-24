/**
 * 判官输入规范（Judge Input Spec）。
 *
 * 口径漂移的根因是「判官看什么」由调用方各自拼接：harness 一套、
 * 管理端调试一套。这里把来源挑选、截断与脱敏收进判官端点自身，
 * harness 只传原始字段（`sources` 或 `expectedDocIds/citedDocIds`）。
 *
 * v1 保留旧行为（不脱敏、按传入顺序截断），仅用于历史对照；
 * v2 是 `ai-eval-loop` 的正式口径：relatedness 排序 + 同一
 * `redactForJudge()` 处理 answer 与 sources。
 */

import { createHash } from 'node:crypto';
import { redactPiiText } from '@api/common/utils/pii-redaction';

export const JUDGE_INPUT_SPEC_VERSION = 'v2';

/** 允许显式切回 v1 做历史对照；非法值回落 v2。 */
export type JudgeSpecVersion = 'v1' | 'v2';

export function resolveJudgeSpecVersion(raw?: string | null): JudgeSpecVersion {
  return String(raw ?? '')
    .trim()
    .toLowerCase() === 'v1'
    ? 'v1'
    : 'v2';
}

export const JUDGE_MAX_SOURCE_CHARS = 2000;
export const JUDGE_MAX_TOTAL_SOURCE_CHARS = 8000;
export const JUDGE_MAX_ANSWER_CHARS = 4000;

export interface JudgeSource {
  title?: string;
  docId?: string;
  content: string;
  /** 调用方已有的相关度；没有时由 question/answer 词面重叠加权计算。 */
  score?: number;
}

export interface JudgeInputOptions {
  question: string;
  answer: string;
  sources?: JudgeSource[];
  expectedDocIds?: string[];
  citedDocIds?: string[];
  specVersion?: JudgeSpecVersion;
}

export interface JudgeInput {
  /** 最终送审文本（判官唯一依据）。 */
  input: string;
  /** 对送审文本做 sha256；同输入必同 hash。 */
  judgeInputHash: string;
  specVersion: JudgeSpecVersion;
  sourceCount: number;
  sourceDocIds: string[];
}

export type JudgeErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'output_format'
  | 'policy'
  /** 没有可判的输入（本轮没来源）；不是判官失败，也不该算回答错误。 */
  | 'not_applicable';

/**
 * 判官视角的脱敏：与 trace/管理端共用 `redactPiiText`，
 * 保证同一邮箱在 answer 与 sources 里形态一致，不产生伪差异。
 */
export function redactForJudge(text: string | null | undefined): string {
  return redactPiiText(text) ?? '';
}

/** 与 `tools/eval/e2e/judge.mjs` 的 tokenize 同一规则：英文数字整词 + 单个 CJK 字。 */
function tokenize(text: string): string[] {
  return (
    String(text ?? '')
      .toLowerCase()
      .match(/[a-z0-9]+|[一-鿿]/g) ?? []
  );
}

/** 词面相关度：问题命中权重 2，回答命中权重 1。 */
export function chunkRelevance(
  question: string,
  answer: string,
  content: string,
): number {
  const questionTokens = new Set(tokenize(question));
  const answerTokens = new Set(tokenize(answer));
  const chunkTokens = new Set(tokenize(content));
  let score = 0;
  for (const token of questionTokens) if (chunkTokens.has(token)) score += 2;
  for (const token of answerTokens) if (chunkTokens.has(token)) score += 1;
  return score;
}

interface ScoredSource {
  source: JudgeSource;
  score: number;
  index: number;
  groupKey: string;
}

/**
 * 在预算内挑选来源。
 *
 * 先给每篇文档最相关的一条（多文档时保证覆盖），再按相关度填满；
 * 同分按原始顺序 tie-break，保证 `judgeInputHash` 不抖动。
 */
export function selectJudgeSources(
  sources: JudgeSource[],
  { question = '', answer = '' }: { question?: string; answer?: string } = {},
): JudgeSource[] {
  const scored: ScoredSource[] = sources
    .map((source, index) => {
      const content = redactForJudge(source.content);
      return {
        source: {
          title: source.title,
          docId: source.docId,
          content,
        },
        score: Number.isFinite(source.score)
          ? Number(source.score)
          : chunkRelevance(question, answer, content),
        index,
        groupKey: String(source.docId ?? source.title ?? `#${index}`),
      };
    })
    .filter((item) => item.source.content.trim().length > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const byGroup = new Map<string, ScoredSource[]>();
  for (const item of scored) {
    const list = byGroup.get(item.groupKey) ?? [];
    list.push(item);
    byGroup.set(item.groupKey, list);
  }

  const picked: ScoredSource[] = [];
  const seen = new Set<number>();
  // 第一轮：每组最相关的一条，按组首次出现顺序，避免结果依赖 Map 遍历偶然性。
  const groupOrder = [...byGroup.keys()].sort((a, b) => {
    const left = byGroup.get(a)![0].index;
    const right = byGroup.get(b)![0].index;
    return left - right;
  });
  for (const key of groupOrder) {
    const best = byGroup.get(key)![0];
    picked.push(best);
    seen.add(best.index);
  }
  // 第二轮：其余按相关度补满（去重同样按 index，不按 content 字符串比较）。
  for (const item of scored) {
    if (!seen.has(item.index)) picked.push(item);
  }

  let used = 0;
  const output: JudgeSource[] = [];
  for (const item of picked) {
    if (used >= JUDGE_MAX_TOTAL_SOURCE_CHARS) break;
    const budget = Math.min(
      JUDGE_MAX_SOURCE_CHARS,
      JUDGE_MAX_TOTAL_SOURCE_CHARS - used,
    );
    if (budget <= 0) break;
    const content = item.source.content.slice(0, budget);
    if (content.length === 0) continue;
    used += content.length;
    output.push({ ...item.source, content });
  }
  return output;
}

/** v1：旧行为——不脱敏、按传入顺序截断。 */
function buildV1Input({ question, answer, sources = [] }: JudgeInputOptions) {
  let totalSourceChars = 0;
  const blocks: string[] = [];
  sources.forEach((source, i) => {
    if (totalSourceChars >= JUDGE_MAX_TOTAL_SOURCE_CHARS) return;
    const remaining = JUDGE_MAX_TOTAL_SOURCE_CHARS - totalSourceChars;
    const content = String(source.content ?? '').slice(
      0,
      Math.min(JUDGE_MAX_SOURCE_CHARS, remaining),
    );
    totalSourceChars += content.length;
    blocks.push(
      `[${i + 1}] ${source.title ?? ''} (${source.docId ?? ''})\n${content}`,
    );
  });
  return {
    input: [
      `QUESTION:\n${question}`,
      `ANSWER:\n${String(answer ?? '').slice(0, JUDGE_MAX_ANSWER_CHARS)}`,
      `SOURCES:\n${blocks.join('\n\n---\n\n')}`,
    ].join('\n\n'),
    selectedSources: sources,
  };
}

/** v2：answer 与 sources 同一脱敏；sources 由规范挑选与截断。 */
function buildV2Input({ question, answer, sources = [] }: JudgeInputOptions) {
  const selectedSources = selectJudgeSources(sources, { question, answer });
  const blocks = selectedSources.map(
    (source, i) =>
      `[${i + 1}] ${source.title ?? ''} (${source.docId ?? ''})\n${source.content}`,
  );
  return {
    input: [
      `QUESTION:\n${question}`,
      `ANSWER:\n${redactForJudge(answer).slice(0, JUDGE_MAX_ANSWER_CHARS)}`,
      `SOURCES:\n${blocks.join('\n\n---\n\n')}`,
    ].join('\n\n'),
    selectedSources,
  };
}

export function hashJudgeInput(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 生成判官输入。`sources` 应由服务端解析（传了 sources 用传入的；
 * 只有 docId 时先按 docId 取 chunk），本函数只负责口径。
 */
export function buildJudgeInput(options: JudgeInputOptions): JudgeInput {
  const specVersion = resolveJudgeSpecVersion(options.specVersion);
  const built =
    specVersion === 'v1' ? buildV1Input(options) : buildV2Input(options);
  return {
    input: built.input,
    judgeInputHash: hashJudgeInput(built.input),
    specVersion,
    sourceCount: built.selectedSources.length,
    sourceDocIds: built.selectedSources
      .map((source) => source.docId)
      .filter((docId): docId is string => typeof docId === 'string'),
  };
}

/** 判官要取 chunk 的 docId：expected 优先、去重、限流。 */
export function resolveJudgeDocIds(
  expectedDocIds: string[] = [],
  citedDocIds: string[] = [],
  max = 10,
): string[] {
  const docIds: string[] = [];
  for (const docId of [...expectedDocIds, ...citedDocIds]) {
    if (typeof docId !== 'string' || docId.length === 0) continue;
    if (docIds.includes(docId)) continue;
    docIds.push(docId);
    if (docIds.length >= max) break;
  }
  return docIds;
}

/**
 * 判官失败归类。判定端点目前只拿到自由文本错误，按最保守的规则归档；
 * 分不出来的一律 `output_format`，不拿错误分类去解释别的问题。
 */
export function classifyJudgeError(error: unknown): JudgeErrorKind {
  const parts: string[] = [];
  if (typeof error === 'string') {
    parts.push(error);
  } else if (error && typeof error === 'object') {
    const err = error as {
      message?: unknown;
      code?: unknown;
      status?: unknown;
      response?: { status?: unknown };
    };
    for (const value of [
      err.message,
      err.code,
      err.status,
      err.response?.status,
    ]) {
      if (value !== undefined && value !== null) parts.push(String(value));
    }
  }
  const text = parts.join(' ').toLowerCase();
  if (/rate.?limit|429|too many requests|quota/.test(text)) return 'rate_limit';
  if (/timeout|timed out|etimedout|aborted|aborterror/.test(text))
    return 'timeout';
  if (/auth|401|403|unauthori|forbidden|invalid api key/.test(text))
    return 'auth';
  if (/policy|content.?filter|safety|blocked|moderation/.test(text))
    return 'policy';
  return 'output_format';
}
