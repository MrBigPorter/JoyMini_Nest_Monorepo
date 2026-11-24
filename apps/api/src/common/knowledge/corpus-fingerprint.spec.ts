import {
  CorpusDocumentInput,
  computeCorpusFingerprint,
  evaluateKnowledgeStability,
} from './corpus-fingerprint';

const GENERATED_AT = '2026-11-24T00:00:00.000Z';

function doc(
  overrides: Partial<CorpusDocumentInput> = {},
): CorpusDocumentInput {
  return {
    id: 'doc-1',
    docId: 'refund-policy',
    locale: 'en',
    title: '退款政策',
    version: 1,
    activeVersion: 1,
    processStatus: 'indexed',
    documentChunks: [
      { documentVersion: 1, chunkIndex: 0, content: '退款 5 个工作日' },
      { documentVersion: 1, chunkIndex: 1, content: '需要审核' },
    ],
    ...overrides,
  };
}

describe('computeCorpusFingerprint', () => {
  it('相同状态幂等', () => {
    const first = computeCorpusFingerprint([doc()], GENERATED_AT);
    const second = computeCorpusFingerprint([doc()], GENERATED_AT);

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.docs).toEqual(first.docs);
  });

  it('只改标题或关键词不影响指纹', () => {
    const before = computeCorpusFingerprint([doc()], GENERATED_AT);
    const after = computeCorpusFingerprint(
      [doc({ title: '退款政策（改名）' })],
      GENERATED_AT,
    );

    expect(after.fingerprint).toBe(before.fingerprint);
  });

  it('上传新版本但未激活：只进待激活，服务中指纹不变', () => {
    const active = computeCorpusFingerprint([doc()], GENERATED_AT);
    const pending = computeCorpusFingerprint(
      [
        doc({
          version: 2,
          processStatus: 'chunked',
          documentChunks: [
            ...doc().documentChunks,
            { documentVersion: 2, chunkIndex: 0, content: '退款 7 个工作日' },
          ],
        }),
      ],
      GENERATED_AT,
    );

    expect(pending.fingerprint).toBe(active.fingerprint);
    expect(pending.pendingActivation).toHaveLength(1);
    expect(pending.pendingActivation[0].reasons).toEqual(
      expect.arrayContaining(['version_not_activated', 'not_indexed']),
    );
  });

  it('激活新版本后指纹随活跃分块变化', () => {
    const before = computeCorpusFingerprint([doc()], GENERATED_AT);
    const after = computeCorpusFingerprint(
      [
        doc({
          version: 2,
          activeVersion: 2,
          processStatus: 'indexed',
          documentChunks: [
            ...doc().documentChunks,
            { documentVersion: 2, chunkIndex: 0, content: '退款 7 个工作日' },
          ],
        }),
      ],
      GENERATED_AT,
    );

    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.docs[0].activeVersion).toBe(2);
    expect(after.docs[0].activeChunkCount).toBe(1);
    expect(after.pendingActivation).toHaveLength(0);
  });

  it('响应明细不包含正文或分块内容', () => {
    const result = computeCorpusFingerprint([doc()], GENERATED_AT);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('退款 5 个工作日');
    expect(result).not.toHaveProperty('content');
    expect(result.docs[0]).not.toHaveProperty('documentChunks');
  });

  it('从未激活的新文档只出现在待激活列表', () => {
    const result = computeCorpusFingerprint(
      [doc({ version: 1, activeVersion: 0, processStatus: 'uploaded' })],
      GENERATED_AT,
    );

    expect(result.docs).toHaveLength(0);
    expect(result.pendingActivation[0].reasons).toContain('no_active_version');
  });
});

describe('evaluateKnowledgeStability', () => {
  it('服务端与 harness 前后一致才稳定', () => {
    expect(
      evaluateKnowledgeStability({
        serverBefore: 'a',
        serverAfter: 'a',
        harnessBefore: 'a',
        harnessAfter: 'a',
      }),
    ).toEqual({ stable: true, stableReason: 'stable' });
  });

  it('只有服务端一致、harness 变化 → 不稳定', () => {
    expect(
      evaluateKnowledgeStability({
        serverBefore: 'a',
        serverAfter: 'a',
        harnessBefore: 'a',
        harnessAfter: 'b',
      }),
    ).toEqual({ stable: false, stableReason: 'harness_corpus_changed' });
  });

  it('只有 harness 一致、服务端变化 → 不稳定', () => {
    expect(
      evaluateKnowledgeStability({
        serverBefore: 'a',
        serverAfter: 'b',
        harnessBefore: 'a',
        harnessAfter: 'a',
      }),
    ).toEqual({ stable: false, stableReason: 'server_corpus_changed' });
  });

  it('任一来源缺失 → 不稳定，不猜测', () => {
    expect(
      evaluateKnowledgeStability({
        serverBefore: 'a',
        serverAfter: 'a',
        harnessBefore: null,
        harnessAfter: 'a',
      }),
    ).toEqual({ stable: false, stableReason: 'harness_fingerprint_missing' });

    expect(
      evaluateKnowledgeStability({ harnessBefore: 'a', harnessAfter: 'a' }),
    ).toEqual({ stable: false, stableReason: 'server_fingerprint_missing' });
  });

  it('两方各自稳定但值不同 → 不稳定', () => {
    expect(
      evaluateKnowledgeStability({
        serverBefore: 'a',
        serverAfter: 'a',
        harnessBefore: 'b',
        harnessAfter: 'b',
      }),
    ).toEqual({ stable: false, stableReason: 'server_harness_mismatch' });
  });
});
