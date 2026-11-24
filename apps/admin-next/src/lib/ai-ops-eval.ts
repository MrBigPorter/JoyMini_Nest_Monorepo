/**
 * 评测运行展示口径（纯函数，便于单测）。
 *
 * EXTERNAL run 由 harness 写入，只有答案准确性（`summary.accuracy`）；
 * 内部 run 才有任务成功率（`summary.passRate`）。两者不能互相顶替，
 * 否则「准确率 80%」会被读成「任务通过率 80%」。
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
