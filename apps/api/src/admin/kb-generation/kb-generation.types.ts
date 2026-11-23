export type KbCandidateKind =
  | 'INTENT_EXAMPLE'
  | 'KEYWORD'
  | 'GOLDEN_QUERY'
  | 'DOMAIN_DESCRIPTION';

export type KbCandidateStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'APPLIED'
  | 'AUTO_APPLIED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'FAILED'
  | 'ROLLED_BACK';

export type KbGenerationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'SKIPPED'
  | 'FAILED';

export interface RawGoldenQuery {
  query: string;
  lang?: string;
}

/** LLM 的原始输出（已做结构校验，尚未做业务过滤） */
export interface RawKbGeneration {
  keywords: string[];
  intent_examples: string[];
  golden_queries: RawGoldenQuery[];
}

export interface KbGenerationJobData {
  runId: string;
}

/** 经过滤/去重后准备落库的一条候选 */
export interface KbCandidateDraft {
  kind: KbCandidateKind;
  targetDomain: string;
  locale: string;
  text: string;
  normalizedHash: string;
  payload: Record<string, unknown>;
  nearestScore?: number;
  nearestRef?: string;
}

export interface KbGenerationCounts {
  candidateCount: number;
  filteredCount: number;
}
