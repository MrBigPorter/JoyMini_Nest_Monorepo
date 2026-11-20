import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockInsights = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiQualityApi: {
    insightsOverview: (...args: unknown[]) => mockInsights(...args),
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

import AiInsightsPage from '@/app/(dashboard)/ai-ops/insights/page';

const overview = {
  range: { from: '2026-01-01', to: '2026-01-07', timezone: 'UTC' },
  conversations: 22,
  messages: { ai: 120, user: 90, human: 15 },
  feedback: {
    repeatedQuestion: 4,
    abandoned: 2,
    transferred: 12,
    byReviewStatus: [
      { status: 'PENDING', count: 3 },
      { status: 'REVIEWED', count: 1 },
    ],
  },
  transfers: {
    total: 12,
    byReason: [
      { reason: 'explicit_request', count: 7 },
      { reason: 'negative_sentiment', count: 5 },
    ],
    rate: 0.545,
  },
  usage: { totalTokens: 12345, requests: 7 },
  notes: ['口径为 UTC'],
};

function wire(result: any = makeUseRequest(overview)) {
  mockUseRequest.mockImplementation((service: unknown) => {
    if (typeof service === 'function') void (service as () => unknown)();
    return result;
  });
  return result;
}

describe('AiInsightsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsights.mockResolvedValue(overview);
    wire();
  });

  it('renders transfer rate as percentage with numerator/denominator', () => {
    render(<AiInsightsPage />);

    expect(screen.getByText('54.5% (12/22)')).toBeTruthy();
    expect(screen.getByText('用户明确要求')).toBeTruthy();
    expect(screen.getByText('负面情绪')).toBeTruthy();
    expect(screen.getByText('待审核')).toBeTruthy();
    expect(screen.getByText('已审核')).toBeTruthy();
    expect(
      screen.getByText(/2026-01-01 → 2026-01-07 · UTC/),
    ).toBeTruthy();
  });

  it('drills KPI cards down to the relevant pages', () => {
    render(<AiInsightsPage />);

    expect(
      screen.getByRole('link', { name: /Transfer rate/ }).getAttribute('href'),
    ).toBe('/ai-ops/quality?signal=transferred');
    expect(
      screen
        .getByRole('link', { name: /Repeated questions/ })
        .getAttribute('href'),
    ).toBe('/ai-ops/quality?signal=repeated_question');
    expect(
      screen.getByRole('link', { name: /Abandoned/ }).getAttribute('href'),
    ).toBe('/ai-ops/quality?signal=abandoned');
    expect(
      screen.getByRole('link', { name: /Total tokens/ }).getAttribute('href'),
    ).toBe('/ai-ops/usage');
    expect(
      screen.getByRole('link', { name: /Requests/ }).getAttribute('href'),
    ).toBe('/ai-ops/usage');
    expect(
      screen.getByRole('link', { name: /Conversations/ }).getAttribute('href'),
    ).toBe('/customer-service');
  });

  it('validates from <= to and does not call the API with an invalid range', async () => {
    render(<AiInsightsPage />);

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2099-01-01' },
    });

    await waitFor(() => {
      expect(screen.getByText(/开始日期不能晚于结束日期/)).toBeTruthy();
    });

    expect(
      mockInsights.mock.calls.every(
        ([params]) => !((params as any).from > (params as any).to),
      ),
    ).toBe(true);
  });

  it('shows a distinct error state instead of the empty state', () => {
    const result = {
      ...makeUseRequest<unknown>(undefined),
      error: new Error('boom'),
    };
    wire(result);

    render(<AiInsightsPage />);

    expect(screen.getByText('洞察数据加载失败，请重试')).toBeTruthy();
    expect(screen.queryByText('暂无数据')).toBeNull();
  });

  it('shows the empty state when there is no data and no error', () => {
    wire(makeUseRequest(undefined));
    render(<AiInsightsPage />);

    expect(screen.getByText('暂无数据')).toBeTruthy();
  });
});
