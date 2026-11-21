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
    suspectedMisTransfer: 12,
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
    numerator: 12,
    denominator: 22,
  },
  rates: {
    modelError: { numerator: 4, denominator: 5, rate: 0.8 },
    serviceError: { numerator: 1, denominator: 5, rate: 0.2 },
    misTransfer: { numerator: 1, denominator: 4, rate: 0.25 },
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
    expect(screen.getByText(/2026-01-01 → 2026-01-07 · UTC/)).toBeTruthy();
  });

  it('renders 114 §8 rates with Chinese labels and fraction', () => {
    render(<AiInsightsPage />);

    expect(screen.getByText('模型错误率')).toBeTruthy();
    expect(screen.getByText('80.0%')).toBeTruthy();
    expect(screen.getByText('分子/分母：4 / 5')).toBeTruthy();

    expect(screen.getByText('服务故障率')).toBeTruthy();
    expect(screen.getByText('20.0%')).toBeTruthy();
    expect(screen.getByText('分子/分母：1 / 5')).toBeTruthy();

    expect(screen.getByText('误转率')).toBeTruthy();
    expect(screen.getByText('25.0%')).toBeTruthy();
    expect(screen.getByText('分子/分母：1 / 4')).toBeTruthy();

    // 人工消息不再恒为 0；疑似误转单独展示
    expect(screen.getByText('人工消息（客服回复）')).toBeTruthy();
    expect(screen.getByText('疑似误转（信号区）')).toBeTruthy();
  });

  it('drills KPI cards down to the relevant pages', () => {
    render(<AiInsightsPage />);

    expect(
      screen.getByRole('link', { name: /转人工率/ }).getAttribute('href'),
    ).toBe('/ai-ops/quality?signal=transferred');
    expect(
      screen.getByRole('link', { name: /重复追问/ }).getAttribute('href'),
    ).toBe('/ai-ops/quality?queue=SIGNAL&signal=repeated_question');
    expect(
      screen.getByRole('link', { name: /用户放弃/ }).getAttribute('href'),
    ).toBe('/ai-ops/quality?queue=SIGNAL&signal=abandoned');
    expect(
      screen.getByRole('link', { name: /Token 用量/ }).getAttribute('href'),
    ).toBe('/ai-ops/usage');
    expect(
      screen.getByRole('link', { name: /请求数/ }).getAttribute('href'),
    ).toBe('/ai-ops/usage');
    expect(
      screen.getByRole('link', { name: /会话数/ }).getAttribute('href'),
    ).toBe('/customer-service');
  });

  it('shows 0.0% instead of NaN when denominators are 0', () => {
    const zeroOverview = {
      ...overview,
      transfers: {
        ...overview.transfers,
        total: 0,
        byReason: [],
        rate: 0,
        numerator: 0,
        denominator: 0,
      },
      rates: {
        modelError: { numerator: 0, denominator: 0, rate: 0 },
        serviceError: { numerator: 0, denominator: 0, rate: 0 },
        misTransfer: { numerator: 0, denominator: 0, rate: 0 },
      },
    };
    wire(makeUseRequest(zeroOverview));

    render(<AiInsightsPage />);

    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getAllByText('0.0%').length).toBeGreaterThanOrEqual(3);
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
