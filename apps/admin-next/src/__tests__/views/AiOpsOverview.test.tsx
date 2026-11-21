import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
const mockGetFeedbackSummary = vi.hoisted(() => vi.fn());
const mockSecuritySummary = vi.hoisted(() => vi.fn());
const mockSlaQueue = vi.hoisted(() => vi.fn());
const mockRole = vi.hoisted(() => ({ current: 'ADMIN' }));
const today = new Date().toISOString().slice(0, 10);

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
  chatApi: {
    getFeedbackSummary: (...args: unknown[]) => mockGetFeedbackSummary(...args),
  },
  aiQualityApi: {
    securitySummary: (...args: unknown[]) => mockSecuritySummary(...args),
    slaQueue: (...args: unknown[]) => mockSlaQueue(...args),
  },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => mockRole.current,
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

function feedbackSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    total: 0,
    pending: 0,
    byFailureKind: [],
    byResolution: [],
    ...overrides,
  };
}

function securitySummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    total: 0,
    byType: [],
    byMode: [],
    byStatus: [],
    latestAt: null,
    mode: 'block',
    ...overrides,
  };
}

function slaQueue(
  items: Array<Record<string, unknown>> = [],
  thresholdMinutes = 30,
) {
  return { thresholdMinutes, items };
}

interface RequestOverrides {
  queues?: any;
  failed?: any;
  outbox?: any;
  usage?: any;
  feedback?: any;
  security?: any;
  sla?: any;
}

function setupRequests(overrides: RequestOverrides = {}) {
  const results = [
    overrides.queues ??
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
    overrides.failed ?? makeUseRequest([]),
    overrides.outbox ?? makeUseRequest([]),
    overrides.usage ??
      makeUseRequest({
        totals: { totalTokens: 12345, requests: 7, users: 3 },
      }),
    overrides.feedback ?? makeUseRequest(feedbackSummary()),
    overrides.security ?? makeUseRequest(securitySummary()),
    overrides.sla ?? makeUseRequest(slaQueue()),
  ];
  let index = 0;
  // The page re-renders after data timestamps are captured, so return the
  // same result for the same hook position on every render.
  mockUseRequest.mockImplementation((service: unknown) => {
    if (typeof service === 'function') void service();
    return results[index++ % results.length];
  });
}

describe('AiOpsOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole.current = 'ADMIN';
    mockUseRequest.mockReset();
    mockGetQueues.mockResolvedValue([
      {
        name: 'ai-processing',
        waiting: 12,
        active: 2,
        failed: 1,
        delayed: 0,
        isPaused: false,
      },
    ]);
    mockGetAiFailed.mockResolvedValue([]);
    mockGetOutbox.mockResolvedValue([]);
    mockGetUsageSummary.mockResolvedValue({
      totals: { totalTokens: 12345, requests: 7, users: 3 },
    });
    mockGetFeedbackSummary.mockResolvedValue(feedbackSummary());
    mockSecuritySummary.mockResolvedValue(securitySummary());
    mockSlaQueue.mockResolvedValue(slaQueue());
    setupRequests();
  });

  it('requests today usage and renders real counts', () => {
    render(<AiOpsOverviewPage />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('12,345')).toBeTruthy();

    const call = mockGetUsageSummary.mock.calls[0]?.[0];
    expect(call.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(call.to).toBe(call.from);
  });

  it('renders anomaly cards with real API counts, links, and timestamps', () => {
    setupRequests({
      feedback: makeUseRequest(
        feedbackSummary({
          total: 10,
          pending: 3,
          byFailureKind: [
            { failureKind: 'MODEL_ERROR', count: 2 },
            { failureKind: 'SERVICE_ERROR', count: 1 },
            { failureKind: 'UNEXPECTED_TRANSFER', count: 4 },
          ],
          byResolution: [{ resolution: 'ADDED_TO_EVAL', count: 5 }],
        }),
      ),
      security: makeUseRequest(
        securitySummary({
          total: 9,
          byStatus: [{ status: 'NEW', count: 2 }],
          latestAt: '2026-11-20T08:00:00.000Z',
        }),
      ),
      sla: makeUseRequest(
        slaQueue([
          {
            conversationId: 'c1',
            transferredAt: '2026-11-20T07:00:00.000Z',
            lastMessageAt: '2026-11-20T07:10:00.000Z',
            waitingSeconds: 600,
            breached: true,
          },
          {
            conversationId: 'c2',
            transferredAt: '2026-11-20T07:05:00.000Z',
            lastMessageAt: null,
            waitingSeconds: 300,
            breached: true,
          },
          {
            conversationId: 'c3',
            transferredAt: null,
            lastMessageAt: null,
            waitingSeconds: 10,
            breached: false,
          },
        ]),
      ),
    });

    render(<AiOpsOverviewPage />);

    const cases: Array<[string, string, string]> = [
      [
        'anomaly-pending-feedback',
        '3',
        `/ai-ops/quality?queue=TODO&from=${today}&to=${today}`,
      ],
      ['anomaly-model-error', '2', '/ai-ops/quality?failureKind=MODEL_ERROR'],
      [
        'anomaly-service-error',
        '1',
        '/ai-ops/quality?failureKind=SERVICE_ERROR',
      ],
      [
        'anomaly-unexpected-transfer',
        '4',
        '/ai-ops/quality?failureKind=UNEXPECTED_TRANSFER',
      ],
      [
        'anomaly-added-to-eval',
        '5',
        '/ai-ops/quality?resolution=ADDED_TO_EVAL',
      ],
      ['anomaly-security', '2 / 9', '/ai-ops/security'],
      ['anomaly-sla-waiting', '3', '/ai-ops/support'],
      ['anomaly-sla-breached', '2', '/ai-ops/support'],
    ];

    for (const [testId, value, href] of cases) {
      const card = screen.getByTestId(testId);
      expect(card.getAttribute('href')).toBe(href);
      expect(within(card).getByText(value)).toBeTruthy();
      expect(within(card).getByText(/数据截止/)).toBeTruthy();
    }
  });

  it('renders up to four prioritized attention rows with actionable links', () => {
    setupRequests({
      feedback: makeUseRequest(
        feedbackSummary({
          pending: 3,
          byFailureKind: [{ failureKind: 'SERVICE_ERROR', count: 1 }],
        }),
      ),
      security: makeUseRequest(
        securitySummary({
          total: 9,
          byStatus: [{ status: 'NEW', count: 2 }],
          latestAt: '2026-11-20T08:00:00.000Z',
        }),
      ),
      sla: makeUseRequest(
        slaQueue([
          {
            conversationId: 'c1',
            transferredAt: '2026-11-20T07:00:00.000Z',
            lastMessageAt: '2026-11-20T07:10:00.000Z',
            waitingSeconds: 600,
            breached: true,
          },
        ]),
      ),
    });

    render(<AiOpsOverviewPage />);

    const section = screen.getByTestId('attention-section');
    const rows = within(section).getAllByRole('link');
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/ai-ops/quality?failureKind=SERVICE_ERROR',
      `/ai-ops/quality?queue=TODO&from=${today}&to=${today}`,
      '/ai-ops/support',
      '/ai-ops/security',
    ]);
    for (const row of rows) {
      expect(within(row).getByText(/数据截止/)).toBeTruthy();
    }
  });

  it('shows 今天暂无异常 when anomaly sources load successfully and are zero', () => {
    render(<AiOpsOverviewPage />);
    expect(screen.getByText('今天暂无异常')).toBeTruthy();
  });

  it('shows an error banner and 加载失败 instead of zero when a source fails', () => {
    const failedRequest = {
      ...makeUseRequest(undefined),
      error: new Error('boom'),
    };
    setupRequests({ feedback: failedRequest as any });

    render(<AiOpsOverviewPage />);

    expect(screen.getByText(/部分数据加载失败/)).toBeTruthy();

    const pendingCard = screen.getByTestId('anomaly-pending-feedback');
    expect(within(pendingCard).getByText('加载失败')).toBeTruthy();
    expect(within(pendingCard).getByText('—')).toBeTruthy();
    expect(within(pendingCard).queryByText('0')).toBeNull();

    // 其他已加载的数据源仍显示真实零值，而不是整体被替换成 0 或 —
    const securityCard = screen.getByTestId('anomaly-security');
    expect(within(securityCard).getByText('0 / 0')).toBeTruthy();
    expect(within(securityCard).queryByText('加载失败')).toBeNull();

    const section = screen.getByTestId('attention-section');
    expect(
      within(section).getByText('异常数据加载失败，暂无法确认是否无异常。'),
    ).toBeTruthy();
    expect(within(section).queryByText('今天暂无异常')).toBeNull();
  });

  it('hides engineering quick links for VIEWER', () => {
    mockRole.current = 'VIEWER';
    render(<AiOpsOverviewPage />);

    expect(screen.getByRole('link', { name: /^质量待办$/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^运营洞察$/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^AI Runtime$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^安全事件$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^客户记忆$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /AI 队列等待/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /今日 Token/ })).toBeNull();
    expect(screen.getByTestId('anomaly-security').tagName).not.toBe('A');
  });

  it('hides all AI Ops quick links for EDITOR', () => {
    mockRole.current = 'EDITOR';
    render(<AiOpsOverviewPage />);

    // EDITOR 不是运营角色：整个 AI Operations 对 EDITOR 隐藏。
    expect(screen.queryByRole('link', { name: /^质量待办$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^运营洞察$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^AI Runtime$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^安全事件$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^客户记忆$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /AI 队列等待/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /今日 Token/ })).toBeNull();
    expect(screen.getByTestId('anomaly-security').tagName).not.toBe('A');
  });

  it('shows engineering quick links for ADMIN', () => {
    mockRole.current = 'ADMIN';
    render(<AiOpsOverviewPage />);

    expect(screen.getByRole('link', { name: /^AI Runtime$/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^客户记忆$/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /AI 队列等待/ })).toBeTruthy();
    expect(screen.getByTestId('anomaly-security').tagName).toBe('A');
  });
});
