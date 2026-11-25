/**
 * 回归用例时间线与两次运行差异的纯逻辑。
 *
 * 差异只做描述性集合运算（新增失败 / 修复 / 回退 / 仍失败），
 * 不声称统计显著；显著性由 `compare.py` 的配对检验负责。
 * 未判出结论（judge_error / 缺结果）的用例不参与分类，
 * 否则判官故障会被记成回归或修复。
 */

/** 单次运行的判定归一：pass / fail / undecided。 */
export type CaseOutcome = 'pass' | 'fail' | 'undecided';

export const CASE_DIFF_CLASSES = [
  'newFailure',
  'fixed',
  'regressed',
  'stillFailing',
] as const;

export type CaseDiffClass = (typeof CASE_DIFF_CLASSES)[number];

/** 外部 answer_accuracy：correct 通过，incorrect 失败，judge_error/空 未判定。 */
export function outcomeFromAnswerVerdict(
  verdict: string | null | undefined,
): CaseOutcome {
  if (verdict === 'correct') return 'pass';
  if (verdict === 'incorrect') return 'fail';
  return 'undecided';
}

/** 内部 verdict3：solved 通过；partial/unsolved 失败；空 未判定。 */
export function outcomeFromVerdict(
  verdict: string | null | undefined,
): CaseOutcome {
  if (verdict === 'solved') return 'pass';
  if (verdict === 'partial' || verdict === 'unsolved') return 'fail';
  return 'undecided';
}

/**
 * 两次运行之间的四分类。
 *
 * `hadEarlierFailure` 区分「首次坏掉」与「修好后又坏」：
 * 基线通过 → 当前失败，且基线之前出现过失败，记回退；否则记新增失败。
 */
export function classifyCaseDiff(input: {
  baseline: CaseOutcome;
  current: CaseOutcome;
  hadEarlierFailure: boolean;
}): CaseDiffClass | null {
  const { baseline, current } = input;
  if (baseline === 'undecided' || current === 'undecided') return null;
  if (baseline === 'fail' && current === 'pass') return 'fixed';
  if (baseline === 'fail' && current === 'fail') return 'stillFailing';
  if (baseline === 'pass' && current === 'fail') {
    return input.hadEarlierFailure ? 'regressed' : 'newFailure';
  }
  return null;
}

/** 按时间升序的历史点里，`index` 之前是否出现过失败。 */
export function hadFailureBefore(
  points: ReadonlyArray<{ outcome: CaseOutcome }>,
  index: number,
): boolean {
  return points
    .slice(0, Math.max(0, index))
    .some((point) => point.outcome === 'fail');
}
