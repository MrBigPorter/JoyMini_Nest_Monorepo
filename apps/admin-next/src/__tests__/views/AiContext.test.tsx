import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockCanReadContext = vi.hoisted(() => vi.fn(() => true));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiContextApi: { inspect: vi.fn() },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => 'ADMIN',
  canReadContext: () => mockCanReadContext(),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiContextPage from '@/app/(dashboard)/ai-ops/context/page';

const snapshot = {
  conversationId: 'conv-1',
  threadId: 'thread-1',
  checkpointId: 'cp-1',
  previousIntent: 'order_query',
  flowState: {
    activeFlow: 'withdrawal',
    step: 'confirm',
    status: 'waiting',
    data: { amount: '500' },
  },
  contextState: {
    activeEntity: '包包',
    slots: { amount: '500' },
    corrections: [
      { from: '苹果手机', to: '包包', at: 1730000000000 },
    ],
    unresolved: ['确认用户当前要找的是包包'],
  },
  pendingConfirm: {
    action: 'claim_coupon',
    params: { couponId: 'c-1' },
    summary: { title: '新人券' },
  },
  messages: [
    {
      type: 'human',
      content: '我要领券',
      source: 'miniapp',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    { type: 'ai', content: '请确认领取新人券' },
  ],
};

function submitConversation(id = 'conv-1') {
  fireEvent.change(screen.getByPlaceholderText('conversationId'), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
}

describe('AiContextPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanReadContext.mockReturnValue(true);
    mockUseRequest.mockReturnValue(makeUseRequest(null));
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the no-query hint before a conversation is entered', () => {
    render(<AiContextPage />);
    expect(screen.getByText('输入 conversationId 查询')).toBeTruthy();
  });

  it('renders a readable business summary instead of raw JSON', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(snapshot));
    render(<AiContextPage />);
    submitConversation();

    expect(screen.getByText('会话概览')).toBeTruthy();
    expect(screen.getByText('order_query')).toBeTruthy();
    expect(screen.getAllByText('withdrawal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('confirm').length).toBeGreaterThan(0);
    expect(screen.getByText('包包')).toBeTruthy();
    expect(screen.getByText('用户')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('来源 miniapp')).toBeTruthy();
    expect(screen.getAllByText('等待确认，未执行').length).toBeGreaterThan(0);
    expect(screen.getByText('claim_coupon')).toBeTruthy();
    expect(screen.getByText(/从「苹果手机」改为「包包」/)).toBeTruthy();
  });

  it('keeps raw JSON inside a collapsed details section', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(snapshot));
    render(<AiContextPage />);
    submitConversation();

    const summary = screen.getByText('原始 JSON（工程师）');
    const details = summary.closest('details');
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
  });

  it('updates the URL when querying a conversation', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(snapshot));
    render(<AiContextPage />);
    submitConversation('conv-url');

    expect(window.location.search).toBe('?conversationId=conv-url');
  });

  it('shows a readable permission message for a 403 response', () => {
    mockUseRequest.mockReturnValue({
      ...makeUseRequest(null),
      error: { response: { status: 403 } },
    });
    render(<AiContextPage />);
    submitConversation();

    expect(screen.getByText(/无权查看该会话上下文（403）/)).toBeTruthy();
  });

  it('denies access entirely for a viewer role', () => {
    mockCanReadContext.mockReturnValue(false);
    render(<AiContextPage />);

    expect(screen.getByText(/无权查看会话上下文/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('conversationId')).toBeNull();
  });

  it('maps snapshot.error codes to readable messages', () => {
    mockUseRequest.mockReturnValue(
      makeUseRequest({ error: 'thread_not_found' }),
    );
    render(<AiContextPage />);
    submitConversation();

    expect(
      screen.getByText(/未找到该会话的 checkpoint/),
    ).toBeTruthy();
    expect(screen.getByText('thread_not_found')).toBeTruthy();
  });

  it('shows an explicit empty state when the snapshot has no data', () => {
    mockUseRequest.mockReturnValue(
      makeUseRequest({
        conversationId: 'conv-empty',
        threadId: 'thread-empty',
        checkpointId: null,
        previousIntent: '',
        flowState: {},
        contextState: {},
        pendingConfirm: null,
        messages: [],
      }),
    );
    render(<AiContextPage />);
    submitConversation('conv-empty');

    expect(
      screen.getByText(
        '该会话暂时没有 flowState、contextState 或消息数据。',
      ),
    ).toBeTruthy();
  });
});
