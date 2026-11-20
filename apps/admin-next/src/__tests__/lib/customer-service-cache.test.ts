import { describe, expect, it, vi } from 'vitest';

// 只需要纯函数，避免真实 API 模块的副作用
vi.mock('@/api', () => ({ chatApi: {} }));

import {
  buildCustomerServiceConversationHref,
  parseConversationIdParam,
} from '@/lib/customer-service-cache';

describe('parseConversationIdParam', () => {
  it('returns a trimmed conversation id from the URL', () => {
    expect(parseConversationIdParam({ conversationId: '  conv-1  ' })).toBe(
      'conv-1',
    );
  });

  it('uses the first value when Next.js provides a repeated param', () => {
    expect(
      parseConversationIdParam({ conversationId: ['conv-1', 'conv-2'] }),
    ).toBe('conv-1');
  });

  it('returns undefined for missing, empty, or whitespace-only ids', () => {
    expect(parseConversationIdParam({})).toBeUndefined();
    expect(parseConversationIdParam({ conversationId: '' })).toBeUndefined();
    expect(parseConversationIdParam({ conversationId: '   ' })).toBeUndefined();
    expect(parseConversationIdParam({ conversationId: [] })).toBeUndefined();
  });
});

describe('buildCustomerServiceConversationHref', () => {
  it('points to the customer service desk with an encoded conversation id', () => {
    expect(buildCustomerServiceConversationHref('conv-1')).toBe(
      '/customer-service?conversationId=conv-1',
    );
    expect(buildCustomerServiceConversationHref('a b&c')).toBe(
      '/customer-service?conversationId=a%20b%26c',
    );
  });
});
