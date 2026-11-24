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
      queue: '',
      from: '',
      to: '',
    });
  });

  it('接受人工复核用的归因值', () => {
    for (const kind of [
      'KNOWLEDGE_GAP',
      'ROUTING',
      'PROMPT',
      'PRODUCT_GAP',
      'LANGUAGE',
    ]) {
      expect(parseFeedbackFilters(`?failureKind=${kind}`).failureKind).toBe(
        kind,
      );
    }
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
      queue: '',
      from: '',
      to: '',
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

  it('解析日期窗并在下钻链接中保留', () => {
    const filters = parseFeedbackFilters(
      '?queue=TODO&from=2026-11-20&to=2026-11-20',
    );

    expect(filters.from).toBe('2026-11-20');
    expect(filters.to).toBe('2026-11-20');
    expect(
      buildQualityHref({
        queue: 'TODO',
        from: filters.from,
        to: filters.to,
      }),
    ).toBe('/ai-ops/quality?queue=TODO&from=2026-11-20&to=2026-11-20');
    expect(parseFeedbackFilters('?from=2026-13-99').from).toBe('');
  });

  it('hasFeedbackFilters 只在有筛选时为 true', () => {
    expect(
      hasFeedbackFilters({
        reviewStatus: '',
        failureKind: '',
        resolution: '',
        signal: '',
        queue: '',
        from: '',
        to: '',
      }),
    ).toBe(false);
    expect(
      hasFeedbackFilters({
        reviewStatus: 'PENDING',
        failureKind: '',
        resolution: '',
        signal: '',
        queue: '',
        from: '',
        to: '',
      }),
    ).toBe(true);
  });
});
