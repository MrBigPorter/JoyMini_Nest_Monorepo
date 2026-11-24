import {
  evaluateRunEvidence,
  type EvidenceConfig,
  type EvidenceRun,
} from './run-evidence.util';

const CONFIG: EvidenceConfig = {
  maxJudgeErrorRate: 0.02,
  minJudgeAgreement: 0.95,
  maxHarnessFailureRate: 0.05,
  currentMetricSpecVersion: '3',
};

function evidenceRun(overrides: Partial<EvidenceRun> = {}): EvidenceRun {
  return {
    id: 'run-1',
    status: 'COMPLETED',
    mode: 'EXTERNAL',
    scope: 'full',
    codeVersion: 'sha-abc',
    judgeSpecVersion: 'v2',
    metricSpecVersion: '3',
    datasetSnapshot: {
      hash: 'dataset-1',
      cases: [{ caseId: 'case-a' }, { caseId: 'case-b' }],
    },
    knowledgeFingerprint: 'fp-1',
    knowledgeSnapshot: {
      fingerprint: 'fp-1',
      docs: [],
      pendingActivation: [],
      stable: true,
      stableReason: 'stable',
    },
    summary: { judgeErrorRate: 0.01, judgeAgreement: 0.97 },
    ...overrides,
  };
}

const RESULTS = [{ judgeErrorKind: null }, { judgeErrorKind: 'timeout' }];

function failedIds(checks: ReturnType<typeof evaluateRunEvidence>['checks']) {
  return checks.filter((item) => !item.ok).map((item) => item.id);
}

describe('evaluateRunEvidence', () => {
  it('全量、稳定、指纹一致、执行完整：通过', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun(),
      results: RESULTS,
      currentFingerprint: 'fp-1',
      config: CONFIG,
    });

    expect(evidence.ok).toBe(true);
    expect(failedIds(evidence.checks)).toEqual([]);
    expect(evidence.codeVersion).toBe('sha-abc');
    expect(evidence.knowledgeFingerprint).toBe('fp-1');
  });

  it('子集运行不通过', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun({ scope: 'subset' }),
      results: RESULTS,
      currentFingerprint: 'fp-1',
      config: CONFIG,
    });

    expect(evidence.ok).toBe(false);
    expect(failedIds(evidence.checks)).toContain('scope');
  });

  it('运行期间语料变化不通过，并带出 stableReason', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun({
        knowledgeSnapshot: {
          pendingActivation: [],
          stable: false,
          stableReason: 'server_corpus_changed',
        },
      }),
      results: RESULTS,
      currentFingerprint: 'fp-1',
      config: CONFIG,
    });

    const stable = evidence.checks.find((item) => item.id === 'stable');
    expect(evidence.ok).toBe(false);
    expect(stable?.message).toContain('server_corpus_changed');
  });

  it('记录指纹与当前语料不一致不通过', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun(),
      results: RESULTS,
      currentFingerprint: 'fp-2',
      config: CONFIG,
    });

    expect(evidence.ok).toBe(false);
    expect(failedIds(evidence.checks)).toContain('fingerprint');
  });

  it('大量跳过（执行数不足）不通过', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun(),
      results: [{ judgeErrorKind: null }],
      currentFingerprint: 'fp-1',
      config: CONFIG,
    });

    const executed = evidence.checks.find(
      (item) => item.id === 'executedCases',
    );
    expect(evidence.ok).toBe(false);
    expect(executed?.message).toContain('executed=1 dataset=2');
  });

  it('harness 失败率超过 5% 不通过', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun(),
      results: [
        { judgeErrorKind: 'harness' },
        { judgeErrorKind: 'harness' },
        { judgeErrorKind: null },
      ],
      currentFingerprint: 'fp-1',
      config: CONFIG,
    });

    expect(evidence.ok).toBe(false);
    expect(failedIds(evidence.checks)).toContain('harnessFailureRate');
  });

  it('存在待激活文档不通过', () => {
    const evidence = evaluateRunEvidence({
      run: evidenceRun({
        knowledgeSnapshot: {
          pendingActivation: [{ docId: 'doc-a' }],
          stable: true,
        },
      }),
      results: RESULTS,
      currentFingerprint: 'fp-1',
      config: CONFIG,
    });

    expect(evidence.ok).toBe(false);
    expect(failedIds(evidence.checks)).toContain('pendingActivation');
  });
});
