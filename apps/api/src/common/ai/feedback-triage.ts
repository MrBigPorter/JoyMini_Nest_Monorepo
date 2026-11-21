/**
 * 反馈分诊的纯规则：不依赖 Nest / Prisma，便于服务、回填脚本和测试共用。
 *
 * 规则见 docs/AI-joymini/113-AI质量运营-数据模型.md §9：
 * - ai_error 转人工优先级最高 → SERVICE_ERROR
 * - 用户明确要求 → EXPECTED_TRANSFER（已排除）
 * - 其余按信号：abandoned / repeated_question / transferred
 */

export type FeedbackSignal = 'transferred' | 'repeated_question' | 'abandoned';

/** 运营归因；与 113 数据模型保持一致。 */
export const FEEDBACK_FAILURE_KINDS = [
  'MODEL_ERROR',
  'SERVICE_ERROR',
  'EXPECTED_TRANSFER',
  'UNEXPECTED_TRANSFER',
  'USER_ABANDONED',
  'REPEATED_QUESTION',
  // 人工复核时真正能指导修复的归因；系统派生不会自动写入这些值。
  'KNOWLEDGE_GAP',
  'ROUTING',
  'PROMPT',
  'PRODUCT_GAP',
  'LANGUAGE',
  'UNKNOWN',
] as const;
export type FeedbackFailureKind = (typeof FEEDBACK_FAILURE_KINDS)[number];

export type FeedbackResolution =
  | 'OPEN'
  | 'CONFIRMED'
  | 'EXCLUDED'
  | 'ADDED_TO_EVAL'
  | 'FIXED_PENDING_VERIFY'
  | 'CLOSED'
  | 'NO_ISSUE';

export interface DerivedTriage {
  failureKind: FeedbackFailureKind | null;
  resolution: FeedbackResolution;
  reviewStatus: 'PENDING' | 'REVIEWED' | 'IGNORED';
}

export function deriveExplicit(verdict: 'correct' | 'incorrect'): DerivedTriage {
  if (verdict === 'correct') {
    return {
      failureKind: null,
      resolution: 'NO_ISSUE',
      reviewStatus: 'REVIEWED',
    };
  }
  return {
    failureKind: 'MODEL_ERROR',
    resolution: 'OPEN',
    reviewStatus: 'PENDING',
  };
}

export function deriveImplicit(
  signal: FeedbackSignal,
  metadata?: Record<string, unknown>,
): DerivedTriage {
  const reason = typeof metadata?.reason === 'string' ? metadata.reason : null;
  if (reason === 'ai_error') {
    return {
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    };
  }
  if (reason === 'explicit_request') {
    return {
      failureKind: 'EXPECTED_TRANSFER',
      resolution: 'EXCLUDED',
      reviewStatus: 'IGNORED',
    };
  }
  switch (signal) {
    case 'abandoned':
      return {
        failureKind: 'USER_ABANDONED',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      };
    case 'repeated_question':
      return {
        failureKind: 'REPEATED_QUESTION',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      };
    case 'transferred':
    default:
      return {
        failureKind: 'UNKNOWN',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      };
  }
}
