import { deduplicateLabels } from './intent-label-categories';

describe('deduplicateLabels', () => {
  it('general 明显领先时只保留 general', () => {
    const labels = [
      { label: 'general', score: 0.92 },
      { label: 'user', score: 0.79 },
    ];
    expect(deduplicateLabels(labels)).toEqual([
      { label: 'general', score: 0.92 },
    ]);
  });

  it('general 领先但差距不足时仍业务优先（原有行为）', () => {
    const labels = [
      { label: 'general', score: 0.86 },
      { label: 'order', score: 0.85 },
    ];
    expect(deduplicateLabels(labels)).toEqual([
      { label: 'order', score: 0.85 },
    ]);
  });

  it('业务标签领先时移除 general', () => {
    const labels = [
      { label: 'order', score: 0.88 },
      { label: 'general', score: 0.8 },
    ];
    expect(deduplicateLabels(labels)).toEqual([
      { label: 'order', score: 0.88 },
    ]);
  });

  it('只有 general 时原样保留', () => {
    const labels = [{ label: 'general', score: 0.92 }];
    expect(deduplicateLabels(labels)).toEqual(labels);
  });

  it('两个业务标签互不影响', () => {
    const labels = [
      { label: 'coupon', score: 0.82 },
      { label: 'order', score: 0.71 },
    ];
    expect(deduplicateLabels(labels)).toEqual(labels);
  });

  it('general 落后时不会因为先出现而留下', () => {
    const labels = [
      { label: 'wallet', score: 0.9 },
      { label: 'general', score: 0.86 },
    ];
    expect(deduplicateLabels(labels)).toEqual([
      { label: 'wallet', score: 0.9 },
    ]);
  });
});
