import { describe, expect, it } from 'vitest';
import {
  applyFeedbackFilters,
  buildQualityHref,
  hasFeedbackFilters,
  parseFeedbackFilters,
} from '@/lib/ai-ops-quality-filters';

describe('ai-ops-quality-filters', () => {
  it('解析合法参数', () => {
    expect(
      parseFeedbackFilters(
        '?reviewStatus=PENDING&failureKind=SERVICE_ERROR&resolution=OPEN&signal=abandoned',
      ),
    ).toEqual({
      reviewStatus: 'PENDING',
      failureKind: 'SERVICE_ERROR',
      resolution: 'OPEN',
      signal: 'abandoned',
    });
  });

  it('非法值被忽略，不产生筛选', () => {
    expect(
      parseFeedbackFilters(
        '?reviewStatus=BOGUS&failureKind=NOPE&resolution=X&signal=other',
      ),
    ).toEqual({
      reviewStatus: '',
      failureKind: '',
      resolution: '',
      signal: '',
    });
  });

  it('应用筛选时保留无关参数，空值删除', () => {
    const current = new URLSearchParams('tab=eval&failureKind=SERVICE_ERROR');

    const next = applyFeedbackFilters(current, {
      failureKind: '',
      signal: 'abandoned',
    });

    expect(next.get('tab')).toBe('eval');
    expect(next.has('failureKind')).toBe(false);
    expect(next.get('signal')).toBe('abandoned');
  });

  it('下钻链接只带一个筛选，避免卡片数与列表数不一致', () => {
    expect(buildQualityHref({ failureKind: 'MODEL_ERROR' })).toBe(
      '/ai-ops/quality?failureKind=MODEL_ERROR',
    );
    expect(
      buildQualityHref({
        failureKind: 'MODEL_ERROR',
        signal: 'abandoned',
      }),
    ).toBe('/ai-ops/quality?failureKind=MODEL_ERROR&signal=abandoned');
    expect(buildQualityHref({})).toBe('/ai-ops/quality');
  });

  it('hasFeedbackFilters 只在有筛选时为 true', () => {
    expect(
      hasFeedbackFilters({
        reviewStatus: '',
        failureKind: '',
        resolution: '',
        signal: '',
      }),
    ).toBe(false);
    expect(
      hasFeedbackFilters({
        reviewStatus: 'PENDING',
        failureKind: '',
        resolution: '',
        signal: '',
      }),
    ).toBe(true);
  });
});
