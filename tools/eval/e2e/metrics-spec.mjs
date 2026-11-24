/**
 * 指标规范的唯一实现（METRIC_SPEC_VERSION = 2）。
 *
 * 任何指标含义、分母或排除项的变化都必须提升版本号；文本定义见
 * `METRICS.md`，报告只负责排版，不再内联公式。
 *
 * 核心约束：
 *   - 两套判定维度不合并：答案准确性（faithful）与任务成功率（solved）分开。
 *   - `judge_error`（faithful === null + errorKind）不进任何准确率分母。
 *   - `harness` / `not_applicable` 不是判官失败，单列且不计入判官错误率。
 */

import { cannedReplyCheck } from "./judge.mjs";

export const METRIC_SPEC_VERSION = 2;

/** 判官失败类型：只有这些进入 judgeErrorRate 分子。 */
export const JUDGE_FAILURE_KINDS = [
  "auth",
  "rate_limit",
  "timeout",
  "output_format",
  "policy",
];

export function wilson(successes, total, z = 1.96) {
  if (!total) return { low: null, high: null };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) /
    denominator;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

export function rate(successes, total) {
  const interval = wilson(successes, total);
  if (!total) return { successes, total, pct: null, low: null, high: null };
  const pct = (successes / total) * 100;
  return {
    successes,
    total,
    pct,
    low: interval.low === null ? null : interval.low * 100,
    high: interval.high === null ? null : interval.high * 100,
  };
}

export function formatRate(bucket) {
  if (!bucket || bucket.total === 0) return "—（0/0）";
  const pct = bucket.pct.toFixed(1);
  const low = bucket.low?.toFixed(1) ?? "?";
  const high = bucket.high?.toFixed(1) ?? "?";
  return `${bucket.successes}/${bucket.total} = ${pct}%（95% CI ${low}–${high}）`;
}

export function percentile(values, p) {
  const list = values.filter((value) => Number.isFinite(value));
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/** 判官给出过布尔判定（correct / incorrect）。 */
export const isJudged = (judge) =>
  Boolean(judge) &&
  judge.faithful !== null &&
  judge.faithful !== undefined;

export function isJudgeError(judge) {
  if (!judge || isJudged(judge)) return false;
  if (
    typeof judge.errorKind === "string" &&
    judge.errorKind.length > 0
  ) {
    return JUDGE_FAILURE_KINDS.includes(judge.errorKind);
  }
  // 旧报告只有自由文本 reason；只认明确的判官失败前缀。
  return /^judge_error\b/.test(String(judge.reason ?? ""));
}

/** 可计入准确率分母：有布尔判定、未被标记不适用、不是判官失败。 */
export const isApplicableJudged = (judge) =>
  isJudged(judge) && judge.applicable !== false && !judge.errorKind;

/**
 * 答案准确性：correct / (correct + incorrect)。
 * `judge_error` 与 `not_applicable` 同时从分子分母排除。
 */
export function answerAccuracy(judges) {
  const list = (judges ?? []).filter(Boolean);
  const judged = list.filter(isApplicableJudged);
  const correct = judged.filter((judge) => judge.faithful === true).length;
  const incorrect = judged.filter((judge) => judge.faithful === false).length;
  return {
    judged: judged.length,
    correct,
    incorrect,
    accuracy: judged.length === 0 ? null : correct / judged.length,
  };
}

/**
 * 判官错误率 = 判官失败 / 全部判定调用。
 * `harness` / `not_applicable` 与「没有调过判官」都不进分母。
 */
export function judgeErrorRate(judges) {
  const list = (judges ?? []).filter(Boolean);
  const attempted = list.filter(
    (judge) => isJudged(judge) || isJudgeError(judge),
  );
  const errors = attempted.filter(isJudgeError);
  return {
    ...rate(errors.length, attempted.length),
    failures: errors.length,
    attempted: attempted.length,
  };
}

/** 判官失败按 errorKind 分布；不属于失败的类型不列出。 */
export function judgeErrorKinds(judges) {
  const counts = new Map();
  for (const judge of (judges ?? []).filter(isJudgeError)) {
    const kind = judge.errorKind ?? "unknown";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({ kind, count }));
}

/**
 * 真实回答率：非兜底回复 / 全部轮次。
 * 兜底话术是「转人工」，不是回答了问题。
 */
export function answeredRate(cases) {
  const rounds = (cases ?? []).flatMap((item) => item?.rounds ?? []);
  const answered = rounds.filter((round) => {
    const content = round?.reply?.content ?? "";
    return Boolean(content) && !cannedReplyCheck(content).canned;
  });
  return rate(answered.length, rounds.length);
}

/**
 * 检索命中率：hitAt3 的用例 / 有 golden 文档且做过检索判定的用例。
 * 没有 golden 的负样本不进分母。
 */
export function hitAt3Rate(cases) {
  const judged = (cases ?? []).filter(
    (item) =>
      Array.isArray(item?.expectedDocIds) &&
      item.expectedDocIds.length > 0 &&
      item?.judge?.retrieval !== undefined,
  );
  const hits = judged.filter((item) => item.judge.retrieval.hitAt3).length;
  return rate(hits, judged.length);
}

/** 单轮时延 95 分位（全部轮次）。 */
export function p95Latency(casesOrRounds) {
  const rounds = (casesOrRounds ?? []).flatMap((item) =>
    Array.isArray(item?.rounds) ? item.rounds : [item],
  );
  return percentile(
    rounds
      .map((round) => round?.latencyMs)
      .filter((value) => Number.isFinite(value)),
    95,
  );
}

/**
 * 无依据风险：知识类用例里 grounding=none 且发布事实断言的条数。
 * 纯澄清与兜底话术不算（它们没有发布事实）。
 */
export function ungroundedRisk(cases) {
  return (cases ?? []).filter((item) => {
    if (item?.kind !== "knowledge" && item?.kind !== "multi") return false;
    const kind =
      item?.judge?.grounding?.kind ?? item?.grounding?.kind ?? null;
    if (kind !== "none") return false;
    if (item?.judge?.canned === true) return false;
    const gate = item?.groundingGate;
    if (gate?.factualAssertion === false) return false;
    return true;
  }).length;
}
