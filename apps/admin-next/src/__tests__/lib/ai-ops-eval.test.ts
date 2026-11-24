import { describe, expect, it } from 'vitest';
import {
  evalAccuracyText,
  evalDeltaText,
  evalHeadline,
  evalPassRateText,
  evalPercentText,
} from '@/lib/ai-ops-eval';

describe('ai-ops-eval 展示口径', () => {
  it('EXTERNAL run 读准确率，不拿 passRate 冒充', () => {
    const headline = evalHeadline({
      mode: 'EXTERNAL',
      summary: { accuracy: 0.843, passRate: 0.1 },
    });
    expect(headline).toEqual({ label: '准确率', value: '84.3%' });
  });

  it('内部 run 读任务通过率；passRate 为 null 时显示 -', () => {
    expect(
      evalHeadline({ mode: 'STORED', summary: { passRate: 0.667 } }),
    ).toEqual({ label: '通过率', value: '66.7%' });
    // verdict / score 改 nullable 后，老 run 可能没有可算的 passRate
    expect(evalHeadline({ mode: 'LIVE', summary: { passRate: null } })).toEqual({
      label: '通过率',
      value: '-',
    });
  });

  it('准确率 0 是有效值，不能被当成缺失', () => {
    expect(evalAccuracyText({ accuracy: 0 })).toBe('0.0%');
    expect(evalPassRateText({ passRate: 0 })).toBe('0.0%');
  });

  it('判官错误率与基线差值：null/缺失统一显示 -', () => {
    expect(evalPercentText(0.02)).toBe('2.0%');
    expect(evalPercentText(null)).toBe('-');
    expect(evalPercentText(undefined)).toBe('-');
    expect(evalPercentText(Number.NaN)).toBe('-');

    expect(evalDeltaText(0.05)).toBe('+5.0%');
    expect(evalDeltaText(-0.02)).toBe('-2.0%');
    expect(evalDeltaText(null)).toBe('-');
  });
});
