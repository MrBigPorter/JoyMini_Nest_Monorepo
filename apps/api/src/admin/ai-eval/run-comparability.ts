/**
 * 跨运行可比性判定（生产模块）。
 *
 * 差异页与用例历史都依赖这组判定，原先只存在于测试专用契约注册表，
 * 生产代码不得不另写一份或干脆不校验。这里成为唯一实现，注册表改为复用。
 *
 * 只做结构判定，不认识具体指标族：族是否已登记由调用方通过
 * `isRegisteredFamily` 注入，避免生产模块反向依赖测试注册表。
 */

/** run 级溯源：展示的分数必须能链回这些字段。 */
export interface RunTrace {
  id?: string | null;
  metricFamily?: string | null;
  metricSpecVersion?: string | null;
  judgeSpecVersion?: string | null;
  datasetSnapshot?: { hash?: string | null } | null;
  scope?: string | null;
}

export interface TraceabilityOptions {
  /** 指标族登记校验；不传则只要求非空。 */
  isRegisteredFamily?: (family: string) => boolean;
}

/** 返回为空表示可溯源；否则逐项列出缺什么。 */
export function runTraceabilityIssues(
  run: RunTrace,
  options: TraceabilityOptions = {},
): string[] {
  const issues: string[] = [];
  if (!run.id?.trim()) issues.push('run id');
  if (!run.metricFamily?.trim()) {
    issues.push('metricFamily');
  } else if (
    options.isRegisteredFamily &&
    !options.isRegisteredFamily(run.metricFamily)
  ) {
    issues.push(`metricFamily ${run.metricFamily} is not registered`);
  }
  if (!run.metricSpecVersion?.trim()) issues.push('metricSpecVersion');
  if (!run.judgeSpecVersion?.trim()) issues.push('judgeSpecVersion');
  const hash = run.datasetSnapshot?.hash;
  if (typeof hash !== 'string' || hash.trim() === '') {
    issues.push('datasetSnapshot.hash');
  }
  if (!run.scope?.trim()) issues.push('scope');
  return issues;
}

/**
 * 两条 run 能否并排比较。返回非空即「比较入口应禁用」，并说明原因。
 * 跨族一票否决：accuracy 减 passRate 只会产出假 delta。
 */
export function comparabilityIssues(
  a: RunTrace,
  b: RunTrace,
  options: TraceabilityOptions = {},
): string[] {
  const issues = [
    ...runTraceabilityIssues(a, options).map((item) => `a: ${item}`),
    ...runTraceabilityIssues(b, options).map((item) => `b: ${item}`),
  ];
  if (issues.length > 0) return issues;
  if (a.metricFamily !== b.metricFamily) {
    return [
      `cross-family comparison: ${String(a.metricFamily)} vs ` +
        `${String(b.metricFamily)}`,
    ];
  }
  if (a.metricSpecVersion !== b.metricSpecVersion) {
    issues.push('metricSpecVersion mismatch');
  }
  if (a.judgeSpecVersion !== b.judgeSpecVersion) {
    issues.push('judgeSpecVersion mismatch');
  }
  if (a.datasetSnapshot?.hash !== b.datasetSnapshot?.hash) {
    issues.push('datasetSnapshot.hash mismatch');
  }
  if (a.scope !== b.scope) issues.push('scope mismatch');
  return issues;
}
