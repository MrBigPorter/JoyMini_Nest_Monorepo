/**
 * 发布证据：一次运行能否证明「当前语料上的回归达标」。
 *
 * 规则是 promote 条件的超集：promote 只看指标与版本，证据还要求
 * scope=full、语料稳定、指纹等于当前、无待激活、执行数完整。
 * 部署 workflow 只调用证据端点，不复制这里的规则。
 */
export interface EvidenceRun {
  id: string;
  status: string;
  mode: string;
  scope: string | null;
  codeVersion: string | null;
  judgeSpecVersion: string | null;
  metricSpecVersion: string | null;
  datasetSnapshot: unknown;
  knowledgeFingerprint: string | null;
  knowledgeSnapshot: unknown;
  summary: unknown;
}

export interface EvidenceResultRow {
  judgeErrorKind?: string | null;
}

export interface EvidenceConfig {
  maxJudgeErrorRate: number;
  minJudgeAgreement: number;
  maxHarnessFailureRate: number;
  currentMetricSpecVersion: string;
}

export interface EvidenceCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface RunEvidence {
  runId: string;
  ok: boolean;
  codeVersion: string | null;
  knowledgeFingerprint: string | null;
  checks: EvidenceCheck[];
}

const DEFAULT_MAX_HARNESS_FAILURE_RATE = 0.05;

function summaryOf(run: EvidenceRun): Record<string, any> | null {
  return run.summary && typeof run.summary === 'object'
    ? (run.summary as Record<string, any>)
    : null;
}

function snapshotOf(run: EvidenceRun): Record<string, any> | null {
  return run.knowledgeSnapshot && typeof run.knowledgeSnapshot === 'object'
    ? (run.knowledgeSnapshot as Record<string, any>)
    : null;
}

function datasetOf(run: EvidenceRun): Record<string, any> | null {
  return run.datasetSnapshot && typeof run.datasetSnapshot === 'object'
    ? (run.datasetSnapshot as Record<string, any>)
    : null;
}

function check(
  id: string,
  ok: boolean,
  failureMessage: string,
  detail?: string,
): EvidenceCheck {
  return {
    id,
    ok,
    message: ok
      ? 'ok'
      : detail
        ? `${failureMessage}（${detail}）`
        : failureMessage,
  };
}

export function maxHarnessFailureRate(): number {
  const raw = Number(process.env.EVAL_MAX_HARNESS_FAILURE_RATE);
  return Number.isFinite(raw) && raw >= 0
    ? raw
    : DEFAULT_MAX_HARNESS_FAILURE_RATE;
}

export function evaluateRunEvidence({
  run,
  results = [],
  currentFingerprint,
  config,
}: {
  run: EvidenceRun;
  results?: EvidenceResultRow[];
  currentFingerprint: string;
  config: EvidenceConfig;
}): RunEvidence {
  const summary = summaryOf(run);
  const snapshot = snapshotOf(run);
  const dataset = datasetOf(run);
  const checks: EvidenceCheck[] = [];

  checks.push(
    check(
      'status',
      run.status === 'COMPLETED',
      '运行未完成，不能作为发布证据',
      `status=${run.status}`,
    ),
  );
  checks.push(
    check(
      'mode',
      run.mode === 'EXTERNAL',
      '只有外部 harness 运行可作为发布证据',
      `mode=${run.mode}`,
    ),
  );
  checks.push(
    check(
      'scope',
      run.scope === 'full',
      '子集运行只用于变更诊断，不能作为发布证据',
      `scope=${run.scope ?? 'null'}`,
    ),
  );
  checks.push(
    check(
      'knowledgeFingerprint',
      typeof run.knowledgeFingerprint === 'string' &&
        run.knowledgeFingerprint.trim().length > 0,
      '运行记录缺少语料指纹，只能作为诊断',
    ),
  );
  checks.push(
    check(
      'stable',
      snapshot?.stable === true,
      '运行期间语料发生变化，证据不可用，请重跑',
      typeof snapshot?.stableReason === 'string'
        ? `stableReason=${snapshot.stableReason}`
        : undefined,
    ),
  );
  checks.push(
    check(
      'fingerprint',
      Boolean(run.knowledgeFingerprint) &&
        run.knowledgeFingerprint === currentFingerprint,
      '运行语料与当前语料不一致，不能证明当前版本',
      `run=${run.knowledgeFingerprint ?? 'null'} current=${currentFingerprint}`,
    ),
  );
  checks.push(
    check(
      'pendingActivation',
      (snapshot?.pendingActivation ?? []).length === 0,
      '存在未激活或未完成索引的文档，发布前必须处理',
      `pending=${(snapshot?.pendingActivation ?? []).length}`,
    ),
  );

  checks.push(
    check(
      'codeVersion',
      typeof run.codeVersion === 'string' && run.codeVersion.trim().length > 0,
      '运行记录缺少代码版本',
    ),
  );
  checks.push(
    check(
      'datasetSnapshot',
      typeof dataset?.hash === 'string' && dataset.hash.trim().length > 0,
      '运行记录缺少数据集快照',
    ),
  );
  checks.push(
    check(
      'judgeSpecVersion',
      typeof run.judgeSpecVersion === 'string' &&
        run.judgeSpecVersion.trim().length > 0,
      '运行记录缺少判官输入规范版本',
    ),
  );
  checks.push(
    check(
      'metricSpecVersion',
      run.metricSpecVersion === config.currentMetricSpecVersion,
      '指标定义版本缺失或与当前不一致，数字不可直接比较',
      `run=${run.metricSpecVersion ?? 'null'} current=${config.currentMetricSpecVersion}`,
    ),
  );

  const judgeErrorRate =
    typeof summary?.judgeErrorRate === 'number' ? summary.judgeErrorRate : null;
  checks.push(
    check(
      'judgeErrorRate',
      judgeErrorRate !== null && judgeErrorRate < config.maxJudgeErrorRate,
      '判官失败率未达标',
      `run=${judgeErrorRate ?? 'null'} max<${config.maxJudgeErrorRate}`,
    ),
  );
  const judgeAgreement =
    typeof summary?.judgeAgreement === 'number' &&
    Number.isFinite(summary.judgeAgreement)
      ? summary.judgeAgreement
      : null;
  checks.push(
    check(
      'judgeAgreement',
      judgeAgreement !== null && judgeAgreement >= config.minJudgeAgreement,
      '判官一致性未达标或未测量',
      `run=${judgeAgreement ?? 'null'} min>=${config.minJudgeAgreement}`,
    ),
  );

  const datasetCases = Array.isArray(dataset?.cases) ? dataset.cases.length : 0;
  checks.push(
    check(
      'executedCases',
      datasetCases > 0 && results.length === datasetCases,
      '实际执行用例数未覆盖数据集用例数',
      `executed=${results.length} dataset=${datasetCases}`,
    ),
  );

  const harnessFailures = results.filter(
    (item) => item.judgeErrorKind === 'harness',
  ).length;
  const harnessFailureRate =
    results.length > 0 ? harnessFailures / results.length : null;
  checks.push(
    check(
      'harnessFailureRate',
      harnessFailureRate !== null &&
        harnessFailureRate <= config.maxHarnessFailureRate,
      'harness 失败率超过阈值',
      `run=${harnessFailureRate ?? 'null'} max<=${config.maxHarnessFailureRate}`,
    ),
  );

  return {
    runId: run.id,
    ok: checks.every((item) => item.ok),
    codeVersion: run.codeVersion,
    knowledgeFingerprint: run.knowledgeFingerprint,
    checks,
  };
}
