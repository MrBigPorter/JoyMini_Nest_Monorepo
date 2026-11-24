import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetTraces = vi.hoisted(() => vi.fn());
const mockGetTrace = vi.hoisted(() => vi.fn());
const mockRole = vi.hoisted(() => ({ current: 'ADMIN' }));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: {
    getTraces: (...args: unknown[]) => mockGetTraces(...args),
    getTrace: (...args: unknown[]) => mockGetTrace(...args),
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => mockRole.current,
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiTracesPage from '@/app/(dashboard)/ai-ops/traces/page';

const row = {
  id: 'trace-1',
  conversationId: 'conv-1',
  triggerMessageId: 'msg-1',
  aiMessageId: 'ai-1',
  userId: 'user-1',
  source: 'production',
  intent: 'order',
  input: '我想查订单',
  output: '您的订单已发货，请留意物流信息',
  status: 'SUCCESS',
  latencyMs: 120,
  promptTokens: 10,
  completionTokens: 20,
  promptName: null,
  promptVersion: null,
  metadata: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const detail = {
  ...row,
  spans: [
    {
      id: 'span-1',
      traceId: 'trace-1',
      type: 'intent',
      name: 'intent-router',
      status: 'OK',
      input: null,
      output: { intent: 'order' },
      error: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      durationMs: null,
      metadata: null,
    },
    {
      id: 'span-2',
      traceId: 'trace-1',
      type: 'llm',
      name: 'llm-response',
      status: 'ERROR',
      input: null,
      output: null,
      error: 'model timeout',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.120Z',
      durationMs: 120,
      metadata: null,
    },
  ],
};

function wireList(
  options: {
    data?: unknown;
    error?: unknown;
    loading?: boolean;
  } = {},
) {
  const listResult = {
    ...makeUseRequest(
      options.data ?? { list: [row], total: 1 },
      options.loading ?? false,
    ),
    ...(options.error ? { error: options.error } : {}),
  };
  mockUseRequest.mockImplementation((service: unknown) => {
    // 立即执行回调，模拟真实 useRequest 首次加载，方便断言筛选参数。
    if (typeof service === 'function') void (service as () => unknown)();
    return listResult;
  });
}

describe('AiTracesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole.current = 'ADMIN';
    mockGetTraces.mockResolvedValue({ list: [row], total: 1 });
    mockGetTrace.mockResolvedValue(detail);
    wireList();
  });

  it('renders trace rows with status, latency, tokens and output snippet', () => {
    render(<AiTracesPage />);

    expect(screen.getByText('order')).toBeTruthy();
    expect(screen.getByText('成功')).toBeTruthy();
    expect(screen.getByText('120 ms')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('您的订单已发货，请留意物流信息')).toBeTruthy();

    const link = screen.getByRole('link', { name: 'conv-1' });
    expect(link.getAttribute('href')).toBe(
      '/ai-ops/context?conversationId=conv-1',
    );
  });

  it('VIEWER 看不到链路原文', async () => {
    mockRole.current = 'VIEWER';
    render(<AiTracesPage />);

    expect(screen.queryByText('您的订单已发货，请留意物流信息')).toBeNull();
    expect(screen.getAllByText('只读账号不显示原文').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    await waitFor(() => {
      expect(screen.getByText('用户输入（截断）')).toBeTruthy();
    });
    expect(screen.queryByText('我想查订单')).toBeNull();
  });

  it('applies conversationId and intent filters and resets page', async () => {
    render(<AiTracesPage />);

    fireEvent.change(screen.getByLabelText('conversationId'), {
      target: { value: 'conv-9' },
    });
    fireEvent.change(screen.getByLabelText('intent'), {
      target: { value: 'wallet' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => {
      expect(mockGetTraces).toHaveBeenLastCalledWith({
        conversationId: 'conv-9',
        intent: 'wallet',
        page: 1,
        pageSize: 20,
      });
    });
  });

  it('reset clears filters', async () => {
    render(<AiTracesPage />);

    fireEvent.change(screen.getByLabelText('conversationId'), {
      target: { value: 'conv-9' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    fireEvent.click(screen.getByRole('button', { name: '重置' }));

    await waitFor(() => {
      expect(mockGetTraces).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
      });
    });
  });

  it('shows a loading state', () => {
    wireList({ data: undefined, loading: true });
    render(<AiTracesPage />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('shows an explicit empty state', () => {
    wireList({ data: { list: [], total: 0 } });
    render(<AiTracesPage />);
    expect(screen.getByText('暂无链路记录。')).toBeTruthy();
  });

  it('shows an error banner with retry', () => {
    wireList({
      data: undefined,
      error: { message: 'boom' },
    });
    render(<AiTracesPage />);

    expect(screen.getByText('链路列表加载失败，请重试。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('paginates with page/pageSize', async () => {
    wireList({ data: { list: [row], total: 45 } });
    render(<AiTracesPage />);

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => {
      expect(mockGetTraces).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
      });
    });
  });

  it('opens the detail panel and expands raw spans', async () => {
    render(<AiTracesPage />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByText('intent-router')).toBeTruthy();
    expect(screen.getByText('llm-response')).toBeTruthy();
    expect(screen.getByText('model timeout')).toBeTruthy();
    expect(mockGetTrace).toHaveBeenCalledWith('trace-1');
    expect(screen.getByText('原始 spans JSON（工程师）')).toBeTruthy();
    expect(screen.getByText('Spans（2）')).toBeTruthy();
  });

  it('shows a detail error when the detail request fails', async () => {
    mockGetTrace.mockRejectedValueOnce(new Error('detail boom'));
    render(<AiTracesPage />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByText('链路详情加载失败，请重试。')).toBeTruthy();
  });
});
