import { sha256 } from '@api/common/crypto.util';

/**
 * 语料指纹：只由「当前正在对外服务的内容」构成。
 *
 * 每篇文档取 `docId|locale|activeVersion|activeChunkHash|activeChunkCount`，
 * 排序后整体 sha256。以下字段故意不进哈希：
 * - `updatedAt` / `activeVersionAt`：激活、元数据编辑都会刷新，不代表正文变化；
 * - `title` / `keywords` / `domain`：检索元数据，不是被回答的正文；
 * - `contentHash`：可能由候选生成惰性写入，不代表当前对外版本。
 *
 * 未激活的新版本不参与指纹，只进入 `pendingActivation`，由证据判定阻止发布。
 */
export interface CorpusChunkInput {
  documentVersion: number;
  chunkIndex: number;
  content: string;
}

export interface CorpusDocumentInput {
  id: string;
  docId: string;
  locale: string;
  title: string;
  version: number;
  activeVersion: number;
  processStatus: string;
  documentChunks: CorpusChunkInput[];
}

export interface CorpusDocEntry {
  id: string;
  docId: string;
  locale: string;
  title: string;
  activeVersion: number;
  activeChunkHash: string;
  activeChunkCount: number;
}

export interface PendingActivationEntry {
  id: string;
  docId: string;
  locale: string;
  title: string;
  version: number;
  activeVersion: number;
  processStatus: string;
  reasons: string[];
}

export interface CorpusFingerprint {
  fingerprint: string;
  docs: CorpusDocEntry[];
  pendingActivation: PendingActivationEntry[];
  generatedAt: string;
}

function compareKey(a: { docId: string; locale: string }, b: { docId: string; locale: string }) {
  return a.docId.localeCompare(b.docId) || a.locale.localeCompare(b.locale);
}

function activeChunksOf(doc: CorpusDocumentInput) {
  return doc.documentChunks
    .filter((chunk) => chunk.documentVersion === doc.activeVersion)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
}

function pendingReasons(doc: CorpusDocumentInput): string[] {
  const reasons: string[] = [];
  if (doc.version > doc.activeVersion) reasons.push('version_not_activated');
  if (doc.processStatus !== 'indexed') reasons.push('not_indexed');
  if (doc.activeVersion === 0) {
    reasons.push('no_active_version');
  } else if (activeChunksOf(doc).length === 0) {
    reasons.push('active_chunks_missing');
  }
  return reasons;
}

export function computeCorpusFingerprint(
  documents: CorpusDocumentInput[],
  generatedAt: string = new Date().toISOString(),
): CorpusFingerprint {
  const docs: CorpusDocEntry[] = [];
  const pendingActivation: PendingActivationEntry[] = [];

  for (const doc of documents) {
    const reasons = pendingReasons(doc);
    if (reasons.length > 0) {
      pendingActivation.push({
        id: doc.id,
        docId: doc.docId,
        locale: doc.locale,
        title: doc.title,
        version: doc.version,
        activeVersion: doc.activeVersion,
        processStatus: doc.processStatus,
        reasons,
      });
    }

    // 待激活不等于没有服务内容：旧 activeVersion 仍在对外回答。
    // 指纹只跟着真正被检索的分块走，上传新版本但未激活时保持不变。
    const activeChunks = activeChunksOf(doc);
    if (doc.activeVersion === 0 || activeChunks.length === 0) continue;

    const activeChunkHash = sha256(
      activeChunks.map((chunk) => `${chunk.chunkIndex}:${chunk.content}`).join('\n'),
    );

    docs.push({
      id: doc.id,
      docId: doc.docId,
      locale: doc.locale,
      title: doc.title,
      activeVersion: doc.activeVersion,
      activeChunkHash,
      activeChunkCount: activeChunks.length,
    });
  }

  docs.sort(compareKey);
  pendingActivation.sort(compareKey);

  const fingerprint = sha256(
    docs
      .map(
        (doc) =>
          `${doc.docId}|${doc.locale}|${doc.activeVersion}|${doc.activeChunkHash}|${doc.activeChunkCount}`,
      )
      .join('\n'),
  );

  return { fingerprint, docs, pendingActivation, generatedAt };
}

export interface KnowledgeStabilityInput {
  serverBefore?: string | null;
  serverAfter?: string | null;
  harnessBefore?: string | null;
  harnessAfter?: string | null;
}

export interface KnowledgeStability {
  stable: boolean;
  stableReason: string;
}

/**
 * 运行期间的语料稳定性。
 *
 * 只信 harness 等于让被测方自证；只信服务端则发现不了「开跑前就已漂移」。
 * 任一来源缺失都按不稳定处理，不猜测。
 */
export function evaluateKnowledgeStability(
  input: KnowledgeStabilityInput,
): KnowledgeStability {
  if (!input.serverBefore || !input.serverAfter) {
    return { stable: false, stableReason: 'server_fingerprint_missing' };
  }
  if (!input.harnessBefore || !input.harnessAfter) {
    return { stable: false, stableReason: 'harness_fingerprint_missing' };
  }
  if (input.serverBefore !== input.serverAfter) {
    return { stable: false, stableReason: 'server_corpus_changed' };
  }
  if (input.harnessBefore !== input.harnessAfter) {
    return { stable: false, stableReason: 'harness_corpus_changed' };
  }
  if (
    input.serverBefore !== input.harnessBefore ||
    input.serverAfter !== input.harnessAfter
  ) {
    return { stable: false, stableReason: 'server_harness_mismatch' };
  }
  return { stable: true, stableReason: 'stable' };
}
