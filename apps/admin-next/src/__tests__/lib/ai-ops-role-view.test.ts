import { describe, expect, it } from 'vitest';

import { defaultTabForRole } from '@/lib/ai-ops-role-view';

describe('defaultTabForRole', () => {
  it('运营（EDITOR / ADMIN）默认落在质量待办队列', () => {
    expect(defaultTabForRole('EDITOR')).toBe('feedback');
    expect(defaultTabForRole('ADMIN')).toBe('feedback');
  });

  it('质量负责人与管理者（SUPER_ADMIN）默认落在回归测试，先看运行与证据', () => {
    expect(defaultTabForRole('SUPER_ADMIN')).toBe('eval');
  });

  it('研发（VIEWER）默认落在质量待办，从带链路证据的队列进入', () => {
    expect(defaultTabForRole('VIEWER')).toBe('feedback');
  });

  it('未知角色退回最保守的队列视图，不猜权限', () => {
    expect(defaultTabForRole('FINANCE')).toBe('feedback');
    expect(defaultTabForRole('')).toBe('feedback');
    expect(defaultTabForRole('viewer')).toBe('feedback');
  });
});
