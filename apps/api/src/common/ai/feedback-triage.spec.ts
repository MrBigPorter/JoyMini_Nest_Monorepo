import {
  deriveExplicit,
  deriveImplicit,
  FEEDBACK_FAILURE_KINDS,
} from './feedback-triage';

describe('feedback-triage', () => {
  it('包含人工复核需要的归因值', () => {
    for (const kind of [
      'KNOWLEDGE_GAP',
      'ROUTING',
      'PROMPT',
      'PRODUCT_GAP',
      'LANGUAGE',
    ]) {
      expect(FEEDBACK_FAILURE_KINDS).toContain(kind);
    }
  });

  it('ai_error 转人工优先判为服务故障', () => {
    expect(deriveImplicit('transferred', { reason: 'ai_error' })).toEqual({
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
  });

  it('用户明确要求转人工不进入待办', () => {
    expect(
      deriveImplicit('transferred', { reason: 'explicit_request' }),
    ).toEqual({
      failureKind: 'EXPECTED_TRANSFER',
      resolution: 'EXCLUDED',
      reviewStatus: 'IGNORED',
    });
  });

  it('中途放弃按用户放弃归因，不再兜底成服务故障', () => {
    expect(deriveImplicit('abandoned', { reason: 'client_left' })).toEqual({
      failureKind: 'USER_ABANDONED',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
  });

  it('重复追问与普通转人工分别归因', () => {
    expect(deriveImplicit('repeated_question', { similarity: 1 })).toEqual({
      failureKind: 'REPEATED_QUESTION',
      resolution: 'OPEN',
      reviewStatus: 'PENDING',
    });
    expect(deriveImplicit('transferred', { reason: 'negative_sentiment' })).toEqual(
      {
        failureKind: 'UNKNOWN',
        resolution: 'OPEN',
        reviewStatus: 'PENDING',
      },
    );
  });

  it('显式正确反馈标记为无问题', () => {
    expect(deriveExplicit('correct')).toEqual({
      failureKind: null,
      resolution: 'NO_ISSUE',
      reviewStatus: 'REVIEWED',
    });
  });
});
