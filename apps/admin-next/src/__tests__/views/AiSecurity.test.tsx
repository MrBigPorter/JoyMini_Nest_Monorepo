import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockSecurityEvents = vi.hoisted(() => vi.fn());
const mockSecuritySummary = vi.hoisted(() => vi.fn());
const mockCanReadContext = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiQualityApi: {
    securityEvents: (...args: unknown[]) => mockSecurityEvents(...args),
    securitySummary: (...args: unknown[]) => mockSecuritySummary(...args),
    securityTriage: vi.fn().mockResolvedValue({ id: 'evt-1' }),
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => 'ADMIN',
  canReadContext: () => mockCanReadContext(),
  canTriageSecurity: () => true,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiSecurityPage from '@/app/(dashboard)/ai-ops/security/page';

const summary = {
  total: 42,
  byType: [
    { type: 'prompt_override', count: 30 },
    { type: 'internal_probe', count: 12 },
  ],
  byMode: [
    { mode: 'log', count: 40 },
    { mode: 'enforce', count: 2 },
  ],
  latestAt: '2026-01-01T00:00:00.000Z',
  mode: 'enforce',
};

const row = {
  id: 'evt-1',
  type: 'prompt_override',
  mode: 'log',
  length: 88,
  userIdHash: 'abcdef1234567890',
  conversationId: 'conv-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function wireRequests(
  options: {
    summaryData?: unknown;
    eventsData?: unknown;
    summaryError?: Error;
    eventsError?: Error;
    loading?: boolean;
  } = {},
) {
  const summaryResult = {
    ...makeUseRequest(
      options.summaryData ?? summary,
      options.loading ?? false,
    ),
    ...(options.summaryError ? { error: options.summaryError } : {}),
  };

  const listResult = {
    ...makeUseRequest(
      options.eventsData ?? { list: [row], total: 42 },
      options.loading ?? false,
    ),
    ...(options.eventsError ? { error: options.eventsError } : {}),
  };

  let index = 0;
  mockUseRequest.mockImplementation((service: unknown) => {
    if (typeof service === 'function') void (service as () => unknown)();
    const isSummary = index % 2 === 0;
    index += 1;
    return isSummary ? summaryResult : listResult;
  });
}

describe('AiSecurityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanReadContext.mockReturnValue(true);
    mockSecuritySummary.mockResolvedValue(summary);
    mockSecurityEvents.mockResolvedValue({ list: [row], total: 42 });
    wireRequests();
  });

  it('renders translated type/mode labels, byMode summary and context link', () => {
    render(<AiSecurityPage />);

    expect(screen.getByText('拦截（拒绝并降级）')).toBeTruthy();
    expect(screen.getAllByText('指令覆盖/越狱').length).toBeGreaterThan(0);
    expect(screen.getAllByText('仅记录（不拦截）').length).toBeGreaterThan(0);
    expect(screen.getByText(/仅记录（不拦截）: 40/)).toBeTruthy();

    const link = screen.getByRole('link', { name: 'conv-1' });
    expect(link.getAttribute('href')).toBe(
      '/ai-ops/context?conversationId=conv-1',
    );
  });

  it('sends page/pageSize and no optional filters initially', () => {
    render(<AiSecurityPage />);

    expect(mockSecuritySummary).toHaveBeenLastCalledWith({});
    expect(mockSecurityEvents).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
    });
  });

  it('resets to page 1 and passes type/from/to to list and summary', async () => {
    render(<AiSecurityPage />);

    fireEvent.change(screen.getByLabelText('Security type'), {
      target: { value: 'privilege_probe' },
    });
    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-01-07' },
    });

    await waitFor(() => {
      expect(mockSecurityEvents).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        type: 'privilege_probe',
        from: '2026-01-01',
        to: '2026-01-07',
      });
      expect(mockSecuritySummary).toHaveBeenLastCalledWith({
        type: 'privilege_probe',
        from: '2026-01-01',
        to: '2026-01-07',
      });
    });
  });

  it('paginates with Prev/Next and keeps pageSize 20', async () => {
    wireRequests({ eventsData: { list: [row], total: 45 } });
    render(<AiSecurityPage />);

    expect(screen.getByText(/第 1 \/ 3 页/)).toBeTruthy();

    fireEvent.click(screen.getByText('下一页'));

    await waitFor(() => {
      expect(mockSecurityEvents).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
      });
    });
  });

  it('shows errors instead of the empty state', () => {
    wireRequests({
      eventsData: { list: [], total: 0 },
      summaryError: new Error('summary down'),
      eventsError: new Error('list down'),
    });
    render(<AiSecurityPage />);

    expect(screen.getByText('安全汇总加载失败，请重试')).toBeTruthy();
    expect(screen.getByText('命中列表加载失败，请重试')).toBeTruthy();
    expect(screen.getByText('加载失败，请重试')).toBeTruthy();
    expect(screen.queryByText(/暂无命中/)).toBeNull();
  });

  it('shows the empty state only when there is no error', () => {
    wireRequests({ eventsData: { list: [], total: 0 } });
    render(<AiSecurityPage />);

    expect(screen.getByText(/暂无命中/)).toBeTruthy();
  });

  it('does not link to Context for roles without permission', () => {
    mockCanReadContext.mockReturnValue(false);
    render(<AiSecurityPage />);

    expect(screen.getByText('conv-1')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'conv-1' })).toBeNull();
  });
});
