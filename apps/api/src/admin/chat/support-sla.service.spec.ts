import { evaluateSupportQueue } from './support-sla.service';

describe('evaluateSupportQueue', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  const thresholdMs = 5 * 60_000;

  it('统计排队数、超 SLA 数与最长等待', () => {
    const snapshot = evaluateSupportQueue(
      [
        { id: 'c1', transferredAt: new Date(now - 10 * 60_000) },
        { id: 'c2', transferredAt: new Date(now - 6 * 60_000) },
        { id: 'c3', transferredAt: new Date(now - 2 * 60_000) },
        { id: 'c4', transferredAt: null },
      ],
      now,
      thresholdMs,
    );

    expect(snapshot.waiting).toBe(4);
    expect(snapshot.breached).toBe(2);
    expect(snapshot.breachedIds).toEqual(['c1', 'c2']);
    expect(snapshot.oldestWaitMs).toBe(10 * 60_000);
  });

  it('刚好等于阈值算超 SLA', () => {
    const snapshot = evaluateSupportQueue(
      [{ id: 'c1', transferredAt: new Date(now - thresholdMs) }],
      now,
      thresholdMs,
    );

    expect(snapshot.breached).toBe(1);
  });

  it('没有 transferredAt 的会话不计入等待时长', () => {
    const snapshot = evaluateSupportQueue(
      [{ id: 'c1', transferredAt: null }],
      now,
      thresholdMs,
    );

    expect(snapshot.waiting).toBe(1);
    expect(snapshot.breached).toBe(0);
    expect(snapshot.oldestWaitMs).toBe(0);
  });
});
