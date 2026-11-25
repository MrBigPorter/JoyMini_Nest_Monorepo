/**
 * 评测运行展示口径（纯函数，便于单测）。
 *
 * 两族指标，同名 key 不能互相顶替：
 *
 * EXTERNAL run（harness 写入，族 `answer_accuracy-v3`）
 * - `accuracy` = correct / (correct + incorrect)，判官失败不进分母
 *
 * 内部 run（族 `verdict3` / 版本 `verdict3-1`，summary.metricFamily 应为主真源）
 * - `passRate`      = solved / total            任务成功率，语义固定不变
 * - `validPassRate` = solved / judged           judged = solved + partial + unsolved（真正判过的）
 * - `judgeErrorRate` / `executionErrorRate` = 失败数 / total       系统故障单独可见
 * - `judged` / `processed` / `total` 解释为什么判过的条数少于总数
 *
 * 判官失败与执行失败都不是「回答错了」：它们不进 unsolved，也不进
 * passRate 的分子。UI 展示通过率时必须说明分母是 total 还是 judged，
 * 否则「通过率 50%」在两种口径下差一倍。
 */

type EvalSummary = Record<string, any> | null | undefined;

function percentText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : '-';
}

export function evalPercentText(value: unknown): string {
  return percentText(value);
}

export function evalPassRateText(summary?: EvalSummary): string {
  return percentText(summary?.passRate);
}

export function evalAccuracyText(summary?: EvalSummary): string {
  return percentText(summary?.accuracy);
}

/** 基线差值：正数带 `+`，null/缺失显示 `-`（nullable verdict 时代没有基线值）。 */
export function evalDeltaText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

/**
 * 运行头部的单一口径：EXTERNAL 读准确率，其他读任务通过率。
 * 返回 label 便于 UI 不把两种指标写成同一个名字。
 */
export function evalHeadline(
  run?: {
    mode?: string | null;
    summary?: EvalSummary;
  } | null,
): { label: string; value: string } {
  if (run?.mode === 'EXTERNAL') {
    return { label: '准确率', value: percentText(run.summary?.accuracy) };
  }
  return { label: '通过率', value: percentText(run?.summary?.passRate) };
}

/** 一次运行的单一指标口径：EXTERNAL 读准确率，其他读任务通过率。 */
export function evalRateText(
  run?: { mode?: string | null; summary?: EvalSummary } | null,
): string {
  return run?.mode === 'EXTERNAL'
    ? percentText(run.summary?.accuracy)
    : percentText(run?.summary?.passRate);
}
