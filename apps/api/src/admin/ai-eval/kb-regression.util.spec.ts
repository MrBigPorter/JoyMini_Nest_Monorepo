import type {
  CorpusDocEntry,
  CorpusFingerprint,
} from '@api/common/knowledge/corpus-fingerprint';
import { computeKbRegressionStatus } from './kb-regression.util';

function corpusDoc(
  docId: string,
  overrides: Partial<CorpusDocEntry> = {},
): CorpusDocEntry {
  return {
    id: `id-${docId}`,
    docId,
    locale: 'en',
    title: docId,
    activeVersion: 1,
    activeChunkHash: `hash-${docId}`,
    activeChunkCount: 2,
    ...overrides,
  };
}

function current(
  docs: CorpusDocEntry[],
  pending: CorpusFingerprint['pendingActivation'] = [],
): CorpusFingerprint {
  return {
    fingerprint: 'fp-current',
    docs,
    pendingActivation: pending,
    generatedAt: '2026-11-24T00:00:00.000Z',
  };
}

function baselineRun(
  docs: CorpusDocEntry[],
  cases: unknown[],
  fingerprint = 'fp-current',
) {
  return {
    id: 'run-full-1',
    finishedAt: '2026-11-23T00:00:00.000Z',
    knowledgeFingerprint: fingerprint,
    knowledgeSnapshot: { fingerprint, docs },
    datasetSnapshot: { hash: 'dataset-1', cases },
  };
}

describe('computeKbRegressionStatus', () => {
  it('没有全量基线：明确要求先跑全量，不猜测映射', () => {
    const status = computeKbRegressionStatus({
      current: current([corpusDoc('doc-a')], [
        { docId: 'doc-pending' },
      ] as CorpusFingerprint['pendingActivation']),
      baseline: null,
      lastSubsetRun: null,
    });

    expect(status.needsFullRun).toBe(true);
    expect(status.covered).toBe(false);
    expect(status.baseline).toBeNull();
    expect(status.changedDocs).toEqual([]);
    expect(status.affectedCaseCount).toBe(0);
    expect(status.pendingActivation).toHaveLength(1);
  });

  it('当前指纹与快照一致：覆盖，受影响用例为 0', () => {
    const docs = [corpusDoc('doc-a'), corpusDoc('doc-b')];
    const status = computeKbRegressionStatus({
      current: current(docs),
      baseline: baselineRun(docs, [
        { caseId: 'knowledge:a', kind: 'knowledge', expectedDocIds: ['doc-a'] },
      ]),
    });

    expect(status.needsFullRun).toBe(false);
    expect(status.covered).toBe(true);
    expect(status.changedDocs).toEqual([]);
    expect(status.affectedCaseIds).toEqual([]);
    expect(status.baseline?.runId).toBe('run-full-1');
  });

  it('有变更：列出新增/删除/内容变化，并映射受影响用例与未覆盖文档', () => {
    const before = [
      corpusDoc('doc-unchanged'),
      corpusDoc('doc-changed', { activeVersion: 1, activeChunkHash: 'old' }),
      corpusDoc('doc-removed'),
    ];
    const after = [
      corpusDoc('doc-unchanged'),
      corpusDoc('doc-changed', { activeVersion: 2, activeChunkHash: 'new' }),
      corpusDoc('doc-added'),
    ];
    const status = computeKbRegressionStatus({
      current: current(after, [
        {
          docId: 'doc-pending',
          reasons: ['version_not_activated'],
        } as CorpusFingerprint['pendingActivation'][number],
      ]),
      baseline: baselineRun(
        before,
        [
          {
            caseId: 'knowledge:changed',
            kind: 'knowledge',
            expectedDocIds: ['doc-changed'],
          },
          {
            caseId: 'knowledge:removed',
            kind: 'knowledge',
            expectedDocIds: ['doc-removed'],
          },
          {
            caseId: 'multi:mixed',
            kind: 'multi',
            expectedDocIds: ['doc-added', 'doc-other'],
          },
          { caseId: 'knowledge:neg', kind: 'negative', expectedDocIds: [] },
        ],
        'fp-old',
      ),
      lastSubsetRun: {
        id: 'run-subset-1',
        finishedAt: '2026-11-24T01:00:00.000Z',
        knowledgeFingerprint: 'fp-subset',
        knowledgeSnapshot: { stable: true },
        summary: { scope: 'subset' },
      },
    });

    expect(status.covered).toBe(false);
    expect(
      status.changedDocs.map((item) => `${item.docId}:${item.change}`),
    ).toEqual([
      'doc-added:added',
      'doc-changed:content_changed',
      'doc-removed:removed',
    ]);
    expect(status.affectedCaseIds).toEqual([
      'knowledge:changed',
      'knowledge:removed',
      'multi:mixed',
    ]);
    expect(status.affectedCaseCount).toBe(3);
    expect(status.uncoveredDocIds).toEqual([]);
    expect(status.pendingActivation).toHaveLength(1);
    expect(status.lastSubsetRun?.id).toBe('run-subset-1');
    expect(status.lastSubsetRun?.stable).toBe(true);
  });

  it('变更文档没有用例覆盖：单列 uncovered，避免静默通过', () => {
    const before = [corpusDoc('doc-old')];
    const after = [
      corpusDoc('doc-old'),
      corpusDoc('doc-new', { activeVersion: 3, activeChunkHash: 'h3' }),
    ];
    const status = computeKbRegressionStatus({
      current: current(after),
      baseline: baselineRun(before, [
        {
          caseId: 'knowledge:old',
          kind: 'knowledge',
          expectedDocIds: ['doc-old'],
        },
      ]),
    });

    expect(status.changedDocs.map((item) => item.docId)).toEqual(['doc-new']);
    expect(status.affectedCaseIds).toEqual([]);
    expect(status.uncoveredDocIds).toEqual(['doc-new']);
  });
});
