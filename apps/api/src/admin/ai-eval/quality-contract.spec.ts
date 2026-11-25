import { AiEvalDatasetService } from './ai-eval-dataset.service';
import {
  AUTHORITY_RULES,
  ENUM_VALUES,
  ENTRY_STATES,
  METRIC_FAMILIES,
  STATE_TRANSITIONS,
  SUMMARY_KEYS,
  TERMINAL_STATES,
  TERMS,
  comparabilityIssues,
  runTraceabilityIssues,
  summaryContractViolations,
} from './quality-contract.registry';

/**
 * 契约门禁（requirements 见 ai-quality/loop-contract spec）：
 * - summary 的 key 只能来自注册表；新增字段未登记即红
 * - 指标族与版本一一配对；summary 缺 metricFamily 即违约
 * - 状态机无死状态；FIXED_PENDING_VERIFY 有自动出边
 * - 对外数字可溯源；缺版本时比较入口被禁用
 *
 * 断言调用真实 buildSummary / buildExternalSummary，而不是手抄 key 列表：
 * 构造逻辑变了、注册表没跟上，测试就红。
 */
function makeService(): AiEvalDatasetService {
  // 两个摘要构造函数都不碰依赖：buildSummary 只读 env，buildExternalSummary
  // 在 baselineRunId=null 时不查库。用空依赖即可，避免把测试绑在 mock 上。
  return new AiEvalDatasetService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function internalSummary(
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  const service = makeService();
  return (service as any).buildSummary({
    mode: 'STORED',
    baselineRunId: null,
    total: 10,
    solved: 6,
    partial: 1,
    unsolved: 1,
    judgeErrors: 1,
    judgeErrorKinds: { timeout: 1 },
    executionErrors: 1,
    executionErrorKinds: { live_call: 1 },
    passRate: 0.6,
    caseVerdicts: [],
    baseline: null,
    usage: {
      estimatedTokens: 100,
      promptTokens: 60,
      completionTokens: 40,
      budget: 10_000,
      exceeded: false,
    },
    failureCategory: undefined,
    ...overrides,
  });
}

async function externalSummary(): Promise<Record<string, any>> {
  const service = makeService();
  return (service as any).buildExternalSummary(
    {
      id: 'run-ext-1',
      baselineRunId: null,
      datasetSnapshot: {
        hash: 'fp-1234',
        cases: [{ caseId: 'q1', question: 'x', expectedDocIds: [] }],
      },
      codeVersion: 'sha-abc',
      gateMode: 'shadow',
      judgeSpecVersion: 'task-judge-v2',
      metricSpecVersion: '3',
      scope: 'full',
    },
    [
      { caseId: 'q1', answerVerdict: 'correct', grounding: 'kb', reason: 'ok' },
      {
        caseId: 'q2',
        answerVerdict: 'judge_error',
        judgeErrorKind: 'timeout',
        grounding: 'unknown',
        reason: 'timeout',
      },
    ],
  );
}

describe('quality-contract 注册表', () => {
  describe('2.1 summary key ⊆ SUMMARY_KEYS', () => {
    it('内部 verdict3 摘要（含基线对比）的 key 全部已登记', () => {
      const base = internalSummary();
      expect(summaryContractViolations(base)).toEqual([]);

      const compared = internalSummary({
        baselineRunId: 'base-1',
        baseline: { passRate: 0.5, verdictByCase: new Map([['c1', 'solved']]) },
        caseVerdicts: [{ caseId: 'c1', verdict: 'unsolved' }],
      });
      expect(compared.newFailures).toBe(1);
      expect(summaryContractViolations(compared)).toEqual([]);
    });

    it('外部 answer_accuracy 摘要的 key 全部已登记', async () => {
      const summary = await externalSummary();
      expect(summary.metricFamily).toBe('answer_accuracy-v3');
      expect(summaryContractViolations(summary)).toEqual([]);
    });

    it('未登记的 summary key 会被门禁指出', () => {
      const summary = { ...internalSummary(), surpriseField: 1 };
      expect(summaryContractViolations(summary)).toEqual([
        'unregistered summary key: surpriseField',
      ]);
    });

    it('每个族至少登记一个 key，且两族 key 集合不共用同名口径字段', () => {
      expect(Object.keys(SUMMARY_KEYS).sort()).toEqual(
        ['answer_accuracy-v3', 'verdict3'].sort(),
      );
      for (const keys of Object.values(SUMMARY_KEYS)) {
        expect(keys.length).toBeGreaterThan(0);
      }
      // 同名字段必须带族标识（metricFamily 两边都有）。
      expect(SUMMARY_KEYS.verdict3).toContain('metricFamily');
      expect(SUMMARY_KEYS['answer_accuracy-v3']).toContain('metricFamily');
    });
  });

  describe('2.2 指标族与版本一一配对', () => {
    it('族版本唯一，且只有运行时族能写 summary', () => {
      const entries = Object.entries(METRIC_FAMILIES);
      const versions = entries.map(([, value]) => value.version);
      expect(new Set(versions).size).toBe(versions.length);

      const runtimeFamilies = entries
        .map(([, value]) => value.summaryFamily)
        .filter(
          (value): value is 'verdict3' | 'answer_accuracy-v3' => value !== null,
        );
      expect(new Set(runtimeFamilies).size).toBe(runtimeFamilies.length);
      expect(runtimeFamilies.sort()).toEqual(
        ['answer_accuracy-v3', 'verdict3'].sort(),
      );
    });

    it('真实摘要的族/版本与注册表一致', async () => {
      const internal = internalSummary();
      expect(METRIC_FAMILIES.verdict3.summaryFamily).toBe(
        internal.metricFamily,
      );
      expect(internal.metricSpecVersion).toBe(
        METRIC_FAMILIES.verdict3.summarySpecVersion,
      );

      const external = await externalSummary();
      expect(METRIC_FAMILIES['answer_accuracy-v3'].summaryFamily).toBe(
        external.metricFamily,
      );
      expect(external.metricSpecVersion).toBe(
        METRIC_FAMILIES['answer_accuracy-v3'].summarySpecVersion,
      );
    });

    it('缺 metricFamily 的 summary 判失败', () => {
      const { metricFamily: _omitted, ...withoutFamily } = internalSummary();
      expect(summaryContractViolations(withoutFamily)).toEqual([
        'metricFamily is missing',
      ]);
    });

    it('未登记的族或版本不匹配判失败', () => {
      expect(
        summaryContractViolations({
          ...internalSummary(),
          metricFamily: 'verdict4',
        }),
      ).toEqual(['metricFamily verdict4 is not registered']);

      expect(
        summaryContractViolations({
          ...internalSummary(),
          metricSpecVersion: 'verdict3-2',
        }),
      ).toEqual(['metricSpecVersion verdict3-2 != registered verdict3-1']);
    });
  });

  describe('2.3 状态机无死状态', () => {
    it('非终态至少一条出边，终态没有出边，转移目标都在册', () => {
      for (const [machine, transitions] of Object.entries(STATE_TRANSITIONS)) {
        const terminal = TERMINAL_STATES[machine as keyof typeof TERMINAL_STATES];
        for (const [state, edges] of Object.entries(transitions)) {
          if ((terminal as readonly string[]).includes(state)) {
            expect({ machine, state, edges }).toEqual({
              machine,
              state,
              edges: [],
            });
            continue;
          }
          expect({ machine, state, hasEdge: edges.length > 0 }).toEqual({
            machine,
            state,
            hasEdge: true,
          });
          for (const edge of edges) {
            expect(Object.keys(transitions)).toContain(edge.to);
          }
        }
      }
    });

    it('每个状态要么是入口，要么有入边', () => {
      for (const [machine, transitions] of Object.entries(STATE_TRANSITIONS)) {
        const entry =
          ENTRY_STATES[machine as keyof typeof ENTRY_STATES] ?? [];
        const targets = new Set<string>();
        for (const edges of Object.values(transitions)) {
          for (const edge of edges) targets.add(edge.to);
        }
        for (const state of Object.keys(transitions)) {
          expect({
            machine,
            state,
            reachable:
              (entry as readonly string[]).includes(state) ||
              targets.has(state),
          }).toEqual({ machine, state, reachable: true });
        }
      }
    });

    it('终态与入口都在状态表里注册', () => {
      for (const [machine, transitions] of Object.entries(STATE_TRANSITIONS)) {
        const known = Object.keys(transitions);
        for (const state of TERMINAL_STATES[
          machine as keyof typeof TERMINAL_STATES
        ]) {
          expect(known).toContain(state);
        }
        for (const state of ENTRY_STATES[
          machine as keyof typeof ENTRY_STATES
        ] ?? []) {
          expect(known).toContain(state);
        }
      }
    });

    it('FIXED_PENDING_VERIFY 由运行结果自动推进到 CLOSED 或打回', () => {
      const edges =
        STATE_TRANSITIONS.regressionStatus.FIXED_PENDING_VERIFY;
      const autoTargets = edges
        .filter((edge) => edge.trigger === 'auto')
        .map((edge) => edge.to);
      expect(autoTargets).toEqual(
        expect.arrayContaining(['CLOSED', 'OPEN']),
      );
      // 不能只剩人工推进：至少一条自动出边指向终态。
      expect(autoTargets).toContain('CLOSED');
    });
  });

  describe('2.4 对外数字可溯源', () => {
    it('run 级必填字段齐全时无溯源缺口', async () => {
      const summary = await externalSummary();
      const trace = {
        id: 'run-ext-1',
        metricFamily: summary.metricFamily,
        metricSpecVersion: summary.metricSpecVersion,
        judgeSpecVersion: summary.judgeSpecVersion,
        datasetSnapshot: { hash: summary.datasetFingerprint },
        scope: summary.scope,
      };
      expect(runTraceabilityIssues(trace)).toEqual([]);
    });

    it('缺 judgeSpecVersion 时溯源失败且比较入口被禁用', () => {
      const trace = {
        id: 'run-1',
        metricFamily: 'verdict3',
        metricSpecVersion: 'verdict3-1',
        judgeSpecVersion: 'task-judge-v2',
        datasetSnapshot: { hash: 'fp-1' },
        scope: 'full',
      };
      expect(runTraceabilityIssues(trace)).toEqual([]);

      const missingVersion = { ...trace, judgeSpecVersion: null };
      expect(runTraceabilityIssues(missingVersion)).toEqual([
        'judgeSpecVersion',
      ]);
      expect(comparabilityIssues(trace, missingVersion)).toEqual([
        'b: judgeSpecVersion',
      ]);
    });

    it('跨族、版本不同、快照不同、scope 不同的 run 不可比较', () => {
      const base = {
        id: 'run-1',
        metricFamily: 'verdict3',
        metricSpecVersion: 'verdict3-1',
        judgeSpecVersion: 'task-judge-v2',
        datasetSnapshot: { hash: 'fp-1' },
        scope: 'full',
      };
      expect(comparabilityIssues(base, { ...base, id: 'run-2' })).toEqual([]);
      expect(
        comparabilityIssues(base, {
          ...base,
          id: 'run-ext',
          metricFamily: 'answer_accuracy-v3',
          metricSpecVersion: '3',
        }),
      ).toEqual([
        'cross-family comparison: verdict3 vs answer_accuracy-v3',
      ]);
      expect(
        comparabilityIssues(base, { ...base, metricSpecVersion: 'verdict3-2' }),
      ).toEqual(['metricSpecVersion mismatch']);
      expect(
        comparabilityIssues(base, {
          ...base,
          datasetSnapshot: { hash: 'fp-2' },
        }),
      ).toEqual(['datasetSnapshot.hash mismatch']);
      expect(
        comparabilityIssues(base, { ...base, scope: 'subset' }),
      ).toEqual(['scope mismatch']);
    });
  });

  describe('1.2 术语与权威层级', () => {
    it('五个术语各有唯一义项，基线不得指对比运行', () => {
      expect(Object.keys(TERMS).sort()).toEqual(
        [
          'baseline',
          'comparisonRun',
          'currentVersion',
          'latestWrittenVersion',
          'pending',
        ].sort(),
      );
      expect(TERMS.baseline.meaning).toContain('按数据集登记');
      expect(TERMS.comparisonRun.meaning).toContain('对比');
      expect(TERMS.pending.meaning).toBe('reviewStatus = PENDING');
      expect(TERMS.currentVersion.meaning).toContain('activeVersion');
      expect(TERMS.latestWrittenVersion.meaning).toContain('最新写入');
    });

    it('权威层级六条齐全，且都禁止进入质量分', () => {
      expect(AUTHORITY_RULES).toHaveLength(6);
      const text = AUTHORITY_RULES.map((rule) => rule.rule).join('\n');
      expect(text).toContain('judge verdict');
      expect(text).toContain('人工标注');
      expect(text).toContain('failureKind');
      expect(text).toContain('AiScore');
      expect(text).toContain('parseQuality');
      expect(text).toContain('术语');
    });
  });
});
