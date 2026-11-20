import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetQueues = vi.hoisted(() => vi.fn());
const mockGetAiFailed = vi.hoisted(() => vi.fn());
const mockGetOutbox = vi.hoisted(() => vi.fn());
const mockGetUsageSummary = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: {
    getQueues: (...args: unknown[]) => mockGetQueues(...args),
    getAiFailed: (...args: unknown[]) => mockGetAiFailed(...args),
    getOutbox: (...args: unknown[]) => mockGetOutbox(...args),
    getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
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

vi.mock('@repo/ui', () => repoUiMock);

import AiOpsOverviewPage from '@/app/(dashboard)/ai-ops/page';

describe('AiOpsOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUsageSummary.mockResolvedValue({
      totals: { totalTokens: 12345, requests: 7, users: 3 },
    });
    const results = [
      makeUseRequest([
        {
          name: 'ai-processing',
          waiting: 12,
          active: 2,
          failed: 1,
          delayed: 0,
          isPaused: false,
        },
      ]),
      makeUseRequest([]),
      makeUseRequest([]),
      makeUseRequest({
        totals: { totalTokens: 12345, requests: 7, users: 3 },
      }),
    ];
    let index = 0;
    mockUseRequest.mockImplementation((service: unknown) => {
      if (typeof service === 'function') void service();
      return results[index++] ?? makeUseRequest(null);
    });
  });

  it('requests today usage and renders real counts', () => {
    render(<AiOpsOverviewPage />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('12,345')).toBeTruthy();

    const call = mockGetUsageSummary.mock.calls[0]?.[0];
    expect(call.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.to).toBe(call.from);
  });

  it('shows a real error banner instead of replacing data with zero', () => {
    mockUseRequest.mockReset();
    mockUseRequest
      .mockReturnValueOnce({ ...makeUseRequest([]), error: new Error('boom') })
      .mockReturnValueOnce(makeUseRequest([]))
      .mockReturnValueOnce(makeUseRequest([]))
      .mockReturnValueOnce(makeUseRequest(null));
    render(<AiOpsOverviewPage />);
    expect(screen.getByText(/部分数据加载失败/)).toBeTruthy();
  });
});
