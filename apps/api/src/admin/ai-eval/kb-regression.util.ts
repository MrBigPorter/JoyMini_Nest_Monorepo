import type {
  CorpusDocEntry,
  CorpusFingerprint,
} from '@api/common/knowledge/corpus-fingerprint';

/** 上次全量运行的最小字段集；只用运行快照，不读 golden。 */
export interface RegressionBaselineRun {
  id: string;
  finishedAt: Date | string | null;
  knowledgeFingerprint: string | null;
  knowledgeSnapshot: unknown;
  datasetSnapshot: unknown;
}

export interface SubsetRunSummary {
  id: string;
  finishedAt: Date | string | null;
  knowledgeFingerprint: string | null;
  stable?: boolean | null;
  knowledgeSnapshot?: unknown;
  summary: unknown;
}

export interface KbDocChange {
  docId: string;
  locale: string;
  change: 'added' | 'removed' | 'content_changed';
  previous: Pick<
    CorpusDocEntry,
    'activeVersion' | 'activeChunkHash' | 'activeChunkCount'
  > | null;
  current: Pick<
    CorpusDocEntry,
    'activeVersion' | 'activeChunkHash' | 'activeChunkCount'
  > | null;
}

export interface KbRegressionStatus {
  currentFingerprint: string;
  generatedAt: string;
  covered: boolean;
  needsFullRun: boolean;
  baseline: {
    runId: string;
    fingerprint: string;
    finishedAt: Date | string | null;
  } | null;
  changedDocs: KbDocChange[];
  affectedCaseIds: string[];
  affectedCaseCount: number;
  /** 变更文档里没有任何用例覆盖的 docId；这些改动不会被回归证明 */
  uncoveredDocIds: string[];
  pendingActivation: CorpusFingerprint['pendingActivation'];
  lastSubsetRun: {
    id: string;
    finishedAt: Date | string | null;
    fingerprint: string | null;
    stable: boolean | null;
    summary: unknown;
  } | null;
}

function docKey(doc: { docId: string; locale: string }) {
  return `${doc.docId}|${doc.locale}`;
}

function snapshotDocs(snapshot: unknown): CorpusDocEntry[] {
  const docs = (snapshot as { docs?: unknown } | null)?.docs;
  return Array.isArray(docs) ? (docs as CorpusDocEntry[]) : [];
}

function subsetSummary(run: SubsetRunSummary | null) {
  if (!run) return null;
  const snapshotStable = (run.knowledgeSnapshot as { stable?: unknown } | null)
    ?.stable;
  const summaryStable = (run.summary as { stable?: unknown } | null)?.stable;
  const stable = snapshotStable ?? summaryStable;
  return {
    id: run.id,
    finishedAt: run.finishedAt,
    fingerprint: run.knowledgeFingerprint,
    stable: typeof stable === 'boolean' ? stable : null,
    summary: run.summary,
  };
}

function brief(doc: CorpusDocEntry | undefined) {
  if (!doc) return null;
  return {
    activeVersion: doc.activeVersion,
    activeChunkHash: doc.activeChunkHash,
    activeChunkCount: doc.activeChunkCount,
  };
}

/**
 * 实时比较「当前语料」与「上次全量运行的语料快照」。
 *
 * 状态是查询时算出来的，不依赖发布事件：事件只做通知。
 * 没有全量快照时明确 `needsFullRun=true`，不猜测受影响用例。
 */
export function computeKbRegressionStatus({
  current,
  baseline,
  lastSubsetRun = null,
}: {
  current: CorpusFingerprint;
  baseline: RegressionBaselineRun | null;
  lastSubsetRun?: SubsetRunSummary | null;
}): KbRegressionStatus {
  const pendingActivation = current.pendingActivation ?? [];
  if (!baseline) {
    return {
      currentFingerprint: current.fingerprint,
      generatedAt: current.generatedAt,
      covered: false,
      needsFullRun: true,
      baseline: null,
      changedDocs: [],
      affectedCaseIds: [],
      affectedCaseCount: 0,
      uncoveredDocIds: [],
      pendingActivation,
      lastSubsetRun: subsetSummary(lastSubsetRun),
    };
  }

  const baselineDocs = new Map(
    snapshotDocs(baseline.knowledgeSnapshot).map((doc) => [docKey(doc), doc]),
  );
  const currentDocs = new Map(current.docs.map((doc) => [docKey(doc), doc]));
  const keys = [
    ...new Set([...baselineDocs.keys(), ...currentDocs.keys()]),
  ].sort();

  const changedDocs: KbDocChange[] = [];
  for (const key of keys) {
    const previous = baselineDocs.get(key);
    const doc = currentDocs.get(key);
    if (!previous && doc) {
      changedDocs.push({
        docId: doc.docId,
        locale: doc.locale,
        change: 'added',
        previous: null,
        current: brief(doc),
      });
      continue;
    }
    if (previous && !doc) {
      changedDocs.push({
        docId: previous.docId,
        locale: previous.locale,
        change: 'removed',
        previous: brief(previous),
        current: null,
      });
      continue;
    }
    if (
      previous &&
      doc &&
      (previous.activeVersion !== doc.activeVersion ||
        previous.activeChunkHash !== doc.activeChunkHash ||
        previous.activeChunkCount !== doc.activeChunkCount)
    ) {
      changedDocs.push({
        docId: doc.docId,
        locale: doc.locale,
        change: 'content_changed',
        previous: brief(previous),
        current: brief(doc),
      });
    }
  }

  const changedDocIds = new Set(changedDocs.map((item) => item.docId));
  const snapshotCases = (baseline.datasetSnapshot as { cases?: unknown } | null)
    ?.cases;
  const cases = Array.isArray(snapshotCases)
    ? (snapshotCases as Array<{
        caseId?: string;
        kind?: string;
        expectedDocIds?: string[];
      }>)
    : [];
  const affectedCaseIds = cases
    .filter(
      (item) =>
        item.kind !== 'negative' &&
        typeof item.caseId === 'string' &&
        (item.expectedDocIds ?? []).some((docId) => changedDocIds.has(docId)),
    )
    .map((item) => item.caseId as string);
  const coveredDocIds = new Set(
    cases.flatMap((item) => item.expectedDocIds ?? []),
  );
  const uncoveredDocIds = [...changedDocIds].filter(
    (docId) => !coveredDocIds.has(docId),
  );

  return {
    currentFingerprint: current.fingerprint,
    generatedAt: current.generatedAt,
    covered:
      current.fingerprint === baseline.knowledgeFingerprint &&
      changedDocs.length === 0,
    needsFullRun: false,
    baseline: {
      runId: baseline.id,
      fingerprint: baseline.knowledgeFingerprint ?? '',
      finishedAt: baseline.finishedAt,
    },
    changedDocs,
    affectedCaseIds,
    affectedCaseCount: affectedCaseIds.length,
    uncoveredDocIds,
    pendingActivation,
    lastSubsetRun: subsetSummary(lastSubsetRun),
  };
}
