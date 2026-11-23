import { describe, expect, it } from 'vitest';
import {
  canDeleteMemory,
  canManageIntentDomains,
  canManageQueues,
  canReadContext,
  canReadMemory,
  canReviewKbCandidates,
  canTriageFeedback,
} from '@/lib/ai-ops-permissions';

describe('ai-ops-permissions', () => {
  it('队列写操作只允许 ADMIN / SUPER_ADMIN', () => {
    expect(canManageQueues('ADMIN')).toBe(true);
    expect(canManageQueues('SUPER_ADMIN')).toBe(true);
    expect(canManageQueues('EDITOR')).toBe(false);
    expect(canManageQueues('VIEWER')).toBe(false);
  });

  it('客户记忆读取允许 ADMIN，永久删除只允许 SUPER_ADMIN', () => {
    expect(canReadMemory('ADMIN')).toBe(true);
    expect(canReadMemory('VIEWER')).toBe(false);
    expect(canDeleteMemory('ADMIN')).toBe(false);
    expect(canDeleteMemory('SUPER_ADMIN')).toBe(true);
  });

  it('Context 只允许 ADMIN / SUPER_ADMIN', () => {
    expect(canReadContext('ADMIN')).toBe(true);
    expect(canReadContext('VIEWER')).toBe(false);
  });

  it('反馈分诊只允许 ADMIN / SUPER_ADMIN', () => {
    expect(canTriageFeedback('ADMIN')).toBe(true);
    expect(canTriageFeedback('EDITOR')).toBe(false);
  });

  it('候选审核只允许 ADMIN / SUPER_ADMIN，VIEWER 只能查看', () => {
    expect(canReviewKbCandidates('SUPER_ADMIN')).toBe(true);
    expect(canReviewKbCandidates('ADMIN')).toBe(true);
    expect(canReviewKbCandidates('EDITOR')).toBe(false);
    expect(canReviewKbCandidates('VIEWER')).toBe(false);
  });

  it('意图域管理只允许 SUPER_ADMIN', () => {
    expect(canManageIntentDomains('SUPER_ADMIN')).toBe(true);
    expect(canManageIntentDomains('ADMIN')).toBe(false);
  });
});
