import {
  comparabilityIssues,
  runTraceabilityIssues,
  type RunTrace,
} from './run-comparability';

/**
 * 跨运行可比性（eval-ingestion-hardening 6.1）
 *
 * 差异页与用例历史都要靠这组判定，所以从测试专用注册表搬到生产模块。
 * 两类问题：溯源字段缺失（缺什么列什么）、两 run 不一致（族/版本/快照/范围）。
 */

const healthyRun = (overrides: Partial<RunTrace> = {}): RunTrace => ({
  id: 'run-1',
  metricFamily: 'verdict3',
  metricSpecVersion: 'verdict3-1',
  judgeSpecVersion: 'task-judge-v2',
  datasetSnapshot: { hash: 'fp-1' },
  scope: 'full',
  ...overrides,
});

describe('runTraceabilityIssues', () => {
  it('字段齐全且族已登记时无缺口', () => {
    expect(
      runTraceabilityIssues(healthyRun(), {
        isRegisteredFamily: (family) => family === 'verdict3',
      }),
    ).toEqual([]);
  });

  it('缺失类：逐项列出缺哪个溯源字段', () => {
    expect(
      runTraceabilityIssues({
        id: '  ',
        metricFamily: '',
        metricSpecVersion: null,
        judgeSpecVersion: undefined,
        datasetSnapshot: { hash: '' },
        scope: null,
      }),
    ).toEqual([
      'run id',
      'metricFamily',
      'metricSpecVersion',
      'judgeSpecVersion',
      'datasetSnapshot.hash',
      'scope',
    ]);
  });

  it('未登记指标族只在提供登记表时判失败', () => {
    const run = healthyRun({ metricFamily: 'verdict4' });
    expect(runTraceabilityIssues(run)).toEqual([]);
    expect(
      runTraceabilityIssues(run, { isRegisteredFamily: () => false }),
    ).toEqual(['metricFamily verdict4 is not registered']);
  });
});

describe('comparabilityIssues', () => {
  it('同族同版本同快照同范围时可比较', () => {
    expect(comparabilityIssues(healthyRun(), healthyRun({ id: 'run-2' }))).toEqual(
      [],
    );
  });

  it('溯源缺口按 a/b 标出', () => {
    expect(
      comparabilityIssues(healthyRun(), healthyRun({ judgeSpecVersion: null })),
    ).toEqual(['b: judgeSpecVersion']);
  });

  it('不一致类：跨族一票否决', () => {
    expect(
      comparabilityIssues(
        healthyRun(),
        healthyRun({
          id: 'run-ext',
          metricFamily: 'answer_accuracy-v3',
          metricSpecVersion: '3',
        }),
      ),
    ).toEqual(['cross-family comparison: verdict3 vs answer_accuracy-v3']);
  });

  it('不一致类：版本、判官版本、快照、范围逐项指出', () => {
    expect(
      comparabilityIssues(
        healthyRun(),
        healthyRun({
          metricSpecVersion: 'verdict3-2',
          judgeSpecVersion: 'task-judge-v3',
          datasetSnapshot: { hash: 'fp-2' },
          scope: 'subset',
        }),
      ),
    ).toEqual([
      'metricSpecVersion mismatch',
      'judgeSpecVersion mismatch',
      'datasetSnapshot.hash mismatch',
      'scope mismatch',
    ]);
  });
});
