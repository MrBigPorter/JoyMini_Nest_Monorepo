import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetFeedbackList = vi.hoisted(() => vi.fn());
const mockGetFeedbackSummary = vi.hoisted(() => vi.fn());
const mockUpdateFeedback = vi.hoisted(() => vi.fn());
const mockListDatasets = vi.hoisted(() => vi.fn());
const mockAddCases = vi.hoisted(() => vi.fn());
const mockStartRun = vi.hoisted(() => vi.fn());
const mockCancelRun = vi.hoisted(() => vi.fn());
const mockRagSearch = vi.hoisted(() => vi.fn());
const mockQualityStats = vi.hoisted(() => vi.fn());
const mockCanTriage = vi.hoisted(() => vi.fn(() => true));
const mockRole = vi.hoisted(() => ({ current: 'ADMIN' }));
const mockAdminId = vi.hoisted(() => ({ current: 'admin-1' }));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: {
    getFeatures: vi
      .fn()
      .mockResolvedValue({ feedbackUiEnabled: true, evalEnabled: true }),
  },
  chatApi: {
    getFeedbackList: (...args: unknown[]) => mockGetFeedbackList(...args),
    getFeedbackSummary: (...args: unknown[]) => mockGetFeedbackSummary(...args),
  },
  aiQualityApi: {
    updateFeedback: (...args: unknown[]) => mockUpdateFeedback(...args),
    listDatasets: (...args: unknown[]) => mockListDatasets(...args),
    getDataset: vi.fn(),
    createDataset: vi.fn(),
    addCases: (...args: unknown[]) => mockAddCases(...args),
    startRun: (...args: unknown[]) => mockStartRun(...args),
    getRun: vi.fn(),
    cancelRun: (...args: unknown[]) => mockCancelRun(...args),
    ragSearch: (...args: unknown[]) => mockRagSearch(...args),
  },
  knowledgeApi: {
    qualityStats: (...args: unknown[]) => mockQualityStats(...args),
  },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => mockRole.current,
  canTriageFeedback: () => mockCanTriage(),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (state: any) => unknown) =>
    selector({
      userInfo: mockAdminId.current ? { id: mockAdminId.current } : null,
    }),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiQualityPage from '@/app/(dashboard)/ai-ops/quality/page';

const feedback = {
  id: 'fb-1',
  conversationId: 'conv-1',
  input: '我的券怎么还不发',
  answer: '请稍等，正在为你查询',
  messageId: 'msg-1',
  userId: 'u-1',
  source: 'implicit',
  verdict: null,
  errorType: null,
  signal: 'transferred',
  note: null,
  adminId: null,
  reviewStatus: 'PENDING',
  failureKind: 'UNEXPECTED_TRANSFER',
  resolution: 'OPEN',
  ownerAdminId: null,
  transferReason: 'ai_error',
  handlerId: 'awaiting_human',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const summary = {
  total: 12,
  pending: 7,
  byFailureKind: [
    { failureKind: 'MODEL_ERROR', count: 2 },
    { failureKind: 'SERVICE_ERROR', count: 1 },
    { failureKind: 'UNEXPECTED_TRANSFER', count: 3 },
  ],
  byResolution: [{ resolution: 'ADDED_TO_EVAL', count: 4 }],
};

const stats = {
  total: 10,
  needReview: 3,
  byScore: { excellent: 4, good: 3, fair: 2, suspicious: 1 },
  recentFlags: [
    {
      documentId: 'doc-1',
      title: '退换货政策',
      score: 0.42,
      flags: '["low_quality"]',
      parsedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const datasets = [
  {
    id: 'ds-1',
    name: '售后退款回归集',
    description: null,
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    _count: { cases: 8, runs: 2 },
  },
];

const evalDatasetDetail = {
  ...datasets[0],
  cases: [
    {
      id: 'case-1',
      datasetId: 'ds-1',
      question: '怎么退款',
      answer: '旧的历史回答',
      expect: {},
      tags: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  runs: [
    {
      id: 'base-run-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'STORED',
      baselineRunId: null,
      createdBy: 'admin',
      summary: { passRate: 0.5, total: 2, solved: 1 },
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T01:00:00.000Z',
    },
    {
      id: 'running-run',
      datasetId: 'ds-1',
      status: 'RUNNING',
      mode: 'LIVE',
      baselineRunId: null,
      createdBy: 'admin',
      summary: null,
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: null,
    },
  ],
};

function wireFeedback(
  options: {
    summaryData?: unknown;
    listData?: unknown;
    datasetsData?: unknown;
    featuresData?: unknown;
    summaryError?: Error;
    listError?: Error;
    refresh?: () => void;
  } = {},
) {
  const refresh = options.refresh ?? vi.fn();
  let index = 0;
  mockUseRequest.mockImplementation((service: unknown) => {
    if (typeof service === 'function') void (service as () => unknown)();
    // FeedbackPanel registers four hooks: features, summary, list, datasets.
    const slot = index % 4;
    index += 1;
    if (slot === 0) {
      return {
        ...makeUseRequest(
          options.featuresData ?? {
            feedbackUiEnabled: true,
            evalEnabled: true,
          },
        ),
        refresh,
        refreshAsync: refresh,
      };
    }
    if (slot === 1) {
      return {
        ...makeUseRequest(options.summaryData ?? summary),
        ...(options.summaryError ? { error: options.summaryError } : {}),
        refresh,
        refreshAsync: refresh,
      };
    }
    if (slot === 2) {
      return {
        ...makeUseRequest(options.listData ?? { list: [feedback], total: 1 }),
        ...(options.listError ? { error: options.listError } : {}),
        refresh,
        refreshAsync: refresh,
      };
    }
    return {
      ...makeUseRequest(options.datasetsData ?? datasets),
      refresh,
      refreshAsync: refresh,
    };
  });
  return refresh;
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

/**
 * EvalPanel 每轮渲染固定注册 3 个 useRequest（列表 / 详情 / 运行），
 * 反馈页 4 个槽位（features/summary/list/datasets），评测页 3 个；
 * 返回的函数在打开页签前调用。
 */
function wireEvalTab(detail: unknown, runData: unknown = null) {
  let index = 0;
  let inEval = false;
  mockUseRequest.mockImplementation((service: unknown) => {
    if (typeof service === 'function') void (service as () => unknown)();
    const slot = index % (inEval ? 3 : 4);
    index += 1;
    if (!inEval) {
      if (slot === 0)
        return {
          ...makeUseRequest({ feedbackUiEnabled: true, evalEnabled: true }),
          refreshAsync: vi.fn(),
        };
      if (slot === 1)
        return { ...makeUseRequest(summary), refreshAsync: vi.fn() };
      if (slot === 2)
        return {
          ...makeUseRequest({ list: [feedback], total: 1 }),
          refreshAsync: vi.fn(),
        };
      return { ...makeUseRequest(datasets), refreshAsync: vi.fn() };
    }
    if (slot === 0) return makeUseRequest(datasets);
    if (slot === 1) return makeUseRequest(detail);
    return makeUseRequest(runData);
  });
  return () => {
    inEval = true;
    // 反馈页卸载后，评测页从自己的第一个 hook 重新计数。
    index = 0;
  };
}

const mockReplace = vi.fn();

describe('AiQualityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue(new URLSearchParams());
    (usePathname as any).mockReturnValue('/ai-ops/quality');
    (useRouter as any).mockReturnValue({
      push: vi.fn(),
      replace: mockReplace,
      back: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    });
    mockCanTriage.mockReturnValue(true);
    mockRole.current = 'ADMIN';
    mockUpdateFeedback.mockResolvedValue({});
    mockGetFeedbackList.mockResolvedValue({ list: [feedback], total: 1 });
    mockGetFeedbackSummary.mockResolvedValue(summary);
    mockListDatasets.mockResolvedValue(datasets);
    mockAddCases.mockResolvedValue({ id: 'ds-1', cases: [] });
    mockStartRun.mockResolvedValue({ id: 'run-new', status: 'RUNNING' });
    mockCancelRun.mockResolvedValue({ id: 'run-1', status: 'CANCELLED' });
    mockRagSearch.mockResolvedValue({ results: [], debug: {} });
    mockQualityStats.mockResolvedValue(stats);
    wireFeedback();
    vi.spyOn(window, 'prompt').mockReturnValue('已确认是模型答非所问');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the operator title and renamed tabs', () => {
    render(<AiQualityPage />);

    expect(screen.getByText('AI 质量')).toBeTruthy();
    expect(screen.getByRole('button', { name: '质量待办' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '回归测试' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '知识质量' })).toBeTruthy();
  });

  it('renders feedback summary KPI cards from the taxonomy summary', () => {
    render(<AiQualityPage />);

    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('模型答错').length).toBeGreaterThan(0);
    expect(screen.getAllByText('服务故障').length).toBeGreaterThan(0);
    expect(screen.getAllByText('误转').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已进回归').length).toBeGreaterThan(0);
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(mockGetFeedbackSummary).toHaveBeenCalled();
  });

  it('reads drill-down filters from the URL and requests them', () => {
    (useSearchParams as any).mockReturnValue(
      new URLSearchParams('failureKind=SERVICE_ERROR&signal=abandoned'),
    );

    render(<AiQualityPage />);

    expect(mockGetFeedbackList).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        failureKind: 'SERVICE_ERROR',
        signal: 'abandoned',
      }),
    );
  });

  it('KPI cards link to the matching filtered list', () => {
    render(<AiQualityPage />);

    expect(
      screen
        .getByRole('link', { name: '服务故障，查看对应反馈' })
        .getAttribute('href'),
    ).toBe('/ai-ops/quality?failureKind=SERVICE_ERROR');
    expect(
      screen
        .getByRole('link', { name: '待处理，查看对应反馈' })
        .getAttribute('href'),
    ).toBe('/ai-ops/quality?queue=TODO');
    expect(
      screen
        .getByRole('link', { name: '系统信号，查看对应反馈' })
        .getAttribute('href'),
    ).toBe('/ai-ops/quality?queue=SIGNAL');
    expect(
      screen
        .getByRole('link', { name: '已进回归，查看对应反馈' })
        .getAttribute('href'),
    ).toBe('/ai-ops/quality?resolution=ADDED_TO_EVAL');
  });

  it('marks a correct answer as NO_ISSUE instead of CONFIRMED', async () => {
    wireFeedback();
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    fireEvent.click(screen.getByRole('button', { name: '回答正确' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        reviewStatus: 'REVIEWED',
        resolution: 'NO_ISSUE',
        verdict: 'correct',
        note: '已确认是模型答非所问',
      }),
    );
  });

  it('writes filter changes to the URL and clears them', () => {
    (useSearchParams as any).mockReturnValue(
      new URLSearchParams('failureKind=SERVICE_ERROR&signal=abandoned'),
    );

    render(<AiQualityPage />);

    fireEvent.change(screen.getByLabelText('来源信号筛选'), {
      target: { value: 'repeated_question' },
    });
    expect(mockReplace).toHaveBeenLastCalledWith(
      '/ai-ops/quality?failureKind=SERVICE_ERROR&signal=repeated_question',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(mockReplace).toHaveBeenLastCalledWith('/ai-ops/quality', {
      scroll: false,
    });
  });

  it('translates feedback source, signal, attribution and resolution', () => {
    render(<AiQualityPage />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('隐式信号')).toBeTruthy();
    expect(within(table).getByText('转人工')).toBeTruthy();
    expect(within(table).getAllByText('误转').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('待处理').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('-').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '确认问题' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '排除' })).toBeTruthy();

    const link = screen.getByRole('link', { name: '查看上下文' });
    expect(link.getAttribute('href')).toBe(
      '/ai-ops/context?conversationId=conv-1',
    );
  });

  it('records the inline cause and shows transfer context in the review card', async () => {
    const refresh = wireFeedback();
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    const card = screen.getByText(/质检 1 \/ 1/).closest('section')!;
    expect(within(card).getByText('转人工原因：AI 异常')).toBeTruthy();
    expect(within(card).getByText('处理客服：等待人工接手')).toBeTruthy();
    expect(within(card).getByText('负责人：未分配')).toBeTruthy();

    fireEvent.change(within(card).getByLabelText('主要原因'), {
      target: { value: 'MODEL_ERROR' },
    });
    fireEvent.click(within(card).getByRole('button', { name: '确认问题' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        reviewStatus: 'REVIEWED',
        resolution: 'CONFIRMED',
        failureKind: 'MODEL_ERROR',
        verdict: 'incorrect',
        note: '已确认是模型答非所问',
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('sends IGNORED + EXCLUDED from the row quick action', async () => {
    wireFeedback();
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '排除' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        reviewStatus: 'IGNORED',
        resolution: 'EXCLUDED',
        failureKind: 'UNEXPECTED_TRANSFER',
        note: '已确认是模型答非所问',
      }),
    );
  });

  it('marks a confirmed item as fixed-pending-verify or closed', async () => {
    wireFeedback({
      listData: {
        list: [
          {
            ...feedback,
            id: 'fb-confirmed',
            reviewStatus: 'REVIEWED',
            resolution: 'CONFIRMED',
            failureKind: 'MODEL_ERROR',
          },
        ],
        total: 1,
      },
    });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '标记已修复待验证' }));
    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-confirmed', {
        resolution: 'FIXED_PENDING_VERIFY',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-confirmed', {
        resolution: 'CLOSED',
      }),
    );
  });

  it('claims ownership for the current admin from the review card', async () => {
    wireFeedback();
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    const card = screen.getByText(/质检 1 \/ 1/).closest('section')!;
    expect(within(card).getByText('负责人：未分配')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: '认领' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        ownerAdminId: 'admin-1',
      }),
    );
    expect(screen.getByText('已认领，负责人是你')).toBeTruthy();
  });

  it('supports J/K, 1/2/3, Enter and Esc shortcuts in review mode', async () => {
    wireFeedback({
      listData: {
        list: [feedback, { ...feedback, id: 'fb-2', input: '第二个问题' }],
        total: 2,
      },
    });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    expect(screen.getByText(/质检 1 \/ 2/)).toBeTruthy();

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByText(/质检 2 \/ 2/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByText(/质检 1 \/ 2/)).toBeTruthy();

    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByText(/当前选择：确认问题/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith(
        'fb-1',
        expect.objectContaining({
          reviewStatus: 'REVIEWED',
          resolution: 'CONFIRMED',
        }),
      ),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/质检 1 \/ 2/)).toBeNull();
  });

  it('batch-excludes only current-page service errors after showing the count', async () => {
    wireFeedback({
      listData: {
        list: [
          { ...feedback, id: 'fb-svc-1', failureKind: 'SERVICE_ERROR' },
          { ...feedback, id: 'fb-svc-2', failureKind: 'SERVICE_ERROR' },
          { ...feedback, id: 'fb-model', failureKind: 'MODEL_ERROR' },
        ],
        total: 3,
      },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AiQualityPage />);

    const button = screen.getByRole('button', { name: /批量排除服务故障/ });
    expect(button.textContent).toContain('2');
    fireEvent.click(button);

    await waitFor(() => expect(mockUpdateFeedback).toHaveBeenCalledTimes(2));
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('2 条服务故障'),
    );
    expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-svc-1', {
      reviewStatus: 'IGNORED',
      resolution: 'EXCLUDED',
      failureKind: 'SERVICE_ERROR',
    });
    expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-svc-2', {
      reviewStatus: 'IGNORED',
      resolution: 'EXCLUDED',
      failureKind: 'SERVICE_ERROR',
    });
    expect(mockUpdateFeedback).not.toHaveBeenCalledWith(
      'fb-model',
      expect.anything(),
    );
    expect(screen.getByText('已批量排除 2 条服务故障')).toBeTruthy();
  });

  it('does not offer batch exclusion when the page only has model errors', () => {
    wireFeedback({
      listData: {
        list: [{ ...feedback, failureKind: 'MODEL_ERROR' }],
        total: 1,
      },
    });
    render(<AiQualityPage />);

    const button = screen.getByRole('button', { name: /批量排除服务故障/ });
    expect(button.textContent).toContain('0');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the add-to-regression action for service-error and expected-transfer rows', () => {
    wireFeedback({
      listData: {
        list: [
          { ...feedback, id: 'fb-svc', failureKind: 'SERVICE_ERROR' },
          { ...feedback, id: 'fb-expected', failureKind: 'EXPECTED_TRANSFER' },
          { ...feedback, id: 'fb-model', failureKind: 'MODEL_ERROR' },
        ],
        total: 3,
      },
    });
    render(<AiQualityPage />);

    const actions = screen.getAllByRole('button', { name: '加入回归' });
    expect(actions).toHaveLength(3);
    expect((actions[0] as HTMLButtonElement).disabled).toBe(true);
    expect((actions[1] as HTMLButtonElement).disabled).toBe(true);
    expect((actions[2] as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates a regression case and links it back to the feedback', async () => {
    const refresh = wireFeedback();
    mockAddCases.mockResolvedValue({
      id: 'ds-1',
      cases: [
        {
          id: 'case-old',
          datasetId: 'ds-1',
          question: feedback.input,
          answer: '旧用例',
          expect: {},
          tags: [],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'case-new',
          datasetId: 'ds-1',
          question: feedback.input,
          answer: feedback.answer,
          expect: {},
          tags: ['from-feedback', 'UNEXPECTED_TRANSFER'],
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '加入回归' }));
    fireEvent.change(screen.getByLabelText('选择回归评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认加入回归' }));

    await waitFor(() =>
      expect(mockAddCases).toHaveBeenCalledWith('ds-1', {
        cases: [
          {
            question: feedback.input,
            answer: feedback.answer,
            expect: { mustMention: ['已确认是模型答非所问'] },
            expected: '已确认是模型答非所问',
            sourceFeedbackId: 'fb-1',
            source: 'feedback',
            tags: ['from-feedback', 'UNEXPECTED_TRANSFER'],
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        linkedEvalCaseId: 'case-new',
        resolution: 'ADDED_TO_EVAL',
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('refuses to create a regression case without an expectation', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('');
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '加入回归' }));
    fireEvent.change(screen.getByLabelText('选择回归评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认加入回归' }));

    await waitFor(() =>
      expect(
        screen.getByText('回归用例必须填写期望答案，否则无法证明修复有效'),
      ).toBeTruthy(),
    );
    expect(mockAddCases).not.toHaveBeenCalled();
  });

  it('routes to the eval tab when no regression dataset exists', () => {
    wireFeedback({ datasetsData: [] });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '加入回归' }));
    expect(screen.getByText('先创建评测集')).toBeTruthy();

    mockUseRequest.mockReturnValue(makeUseRequest([]));
    fireEvent.click(screen.getByRole('button', { name: '去创建评测集' }));

    expect(screen.getByRole('button', { name: '创建评测集' })).toBeTruthy();
  });

  it('shows disabled state when feedback UI is turned off', () => {
    wireFeedback({
      featuresData: { feedbackUiEnabled: false, evalEnabled: true },
    });
    render(<AiQualityPage />);

    expect(
      screen.getByText(/反馈分诊未启用（AI_FEEDBACK_UI_ENABLED=false）/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '开始质检' })).toBeNull();
    expect(screen.queryByRole('button', { name: '确认问题' })).toBeNull();
  });

  it('hides raw question and answer for VIEWER', () => {
    mockRole.current = 'VIEWER';
    mockCanTriage.mockReturnValue(false);
    render(<AiQualityPage />);

    expect(screen.queryByText('我的券怎么还不发')).toBeNull();
    expect(screen.queryByText('请稍等，正在为你查询')).toBeNull();
    expect(screen.getAllByText('只读账号不显示原文').length).toBeGreaterThan(0);
  });

  it('hides triage actions but keeps status and context for read-only roles', () => {
    mockCanTriage.mockReturnValue(false);
    render(<AiQualityPage />);

    expect(screen.queryByRole('button', { name: '确认问题' })).toBeNull();
    expect(screen.queryByRole('button', { name: '排除' })).toBeNull();
    expect(screen.queryByRole('button', { name: '开始质检' })).toBeNull();
    expect(screen.queryByLabelText('主要原因')).toBeNull();
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '查看上下文' })).toBeTruthy();
  });

  it('writes failureKind and resolution filters to the URL', () => {
    render(<AiQualityPage />);

    fireEvent.change(screen.getByLabelText('归因筛选'), {
      target: { value: 'MODEL_ERROR' },
    });
    expect(mockReplace).toHaveBeenLastCalledWith(
      '/ai-ops/quality?failureKind=MODEL_ERROR',
      { scroll: false },
    );

    fireEvent.change(screen.getByLabelText('处理状态筛选'), {
      target: { value: 'CONFIRMED' },
    });
    expect(mockReplace).toHaveBeenLastCalledWith(
      '/ai-ops/quality?resolution=CONFIRMED',
      { scroll: false },
    );
  });

  it('shows an error banner instead of the empty state when the request fails', () => {
    wireFeedback({
      listData: { list: [], total: 0 },
      listError: new Error('feedback down'),
    });
    render(<AiQualityPage />);

    expect(screen.getByText('反馈列表加载失败，请重试')).toBeTruthy();
    expect(screen.queryByText('暂无反馈')).toBeNull();
  });

  it('shows an error banner when the summary request fails', () => {
    wireFeedback({ summaryError: new Error('summary down') });
    render(<AiQualityPage />);

    expect(screen.getByText('反馈汇总加载失败，请重试')).toBeTruthy();
  });

  it('shows the empty state only when the request has no error', () => {
    wireFeedback({ listData: { list: [], total: 0 } });
    render(<AiQualityPage />);

    expect(screen.getByText('暂无反馈')).toBeTruthy();
  });

  it('keeps the JSON import behind a collapsed advanced-mode toggle', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(datasets));
    render(<AiQualityPage />);
    openTab('回归测试');

    expect(screen.queryByLabelText('评测用例 JSON')).toBeNull();
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '高级模式' }));

    expect(screen.getByLabelText('评测用例 JSON')).toBeTruthy();
  });

  it('starts a live run with the selected mode and baseline', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.change(screen.getByLabelText(/评测模式/), {
      target: { value: 'LIVE' },
    });
    fireEvent.change(screen.getByLabelText(/对比基线/), {
      target: { value: 'base-run-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启动批量评测' }));

    await waitFor(() =>
      expect(mockStartRun).toHaveBeenCalledWith('ds-1', {
        mode: 'LIVE',
        baselineRunId: 'base-run-1',
      }),
    );
  });

  it('shows mode, baseline delta, new failures and fixed on the run card', () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'LIVE',
      baselineRunId: 'base-run-1',
      createdBy: 'admin',
      summary: {
        total: 5,
        solved: 4,
        partial: 0,
        unsolved: 1,
        passRate: 0.8,
        mode: 'LIVE',
        baselineRunId: 'base-run-1',
        baselinePassRate: 0.6,
        delta: 0.2,
        newFailures: 1,
        fixed: 2,
      },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:10:00.000Z',
      results: [
        {
          id: 'res-1',
          verdict: 'solved',
          score: 0.9,
          reason: '关键信息齐全',
          actualAnswer: '实时回答：请点申请退款',
          latencyMs: 1200,
          case: evalDatasetDetail.cases[0],
        },
      ],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    expect(screen.getByText('模式：实时跑 AI')).toBeTruthy();
    expect(screen.getByText(/基线 60\.0%/)).toBeTruthy();
    expect(screen.getByText(/变化 \+20\.0%/)).toBeTruthy();
    expect(screen.getByText(/新增失败 1/)).toBeTruthy();
    expect(screen.getByText(/修复 2/)).toBeTruthy();
    expect(screen.getByText('实际回答：实时回答：请点申请退款')).toBeTruthy();
  });

  it('cancels a RUNNING run from the run card', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'running-run',
      datasetId: 'ds-1',
      status: 'RUNNING',
      mode: 'LIVE',
      baselineRunId: null,
      createdBy: 'admin',
      summary: null,
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: null,
      results: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.click(screen.getByRole('button', { name: '取消运行' }));

    await waitFor(() =>
      expect(mockCancelRun).toHaveBeenCalledWith('running-run'),
    );
    expect(screen.getByText('已取消本次运行')).toBeTruthy();
  });

  it('shows the CANCELLED label and cancellation note on a run card', () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'cancelled-run',
      datasetId: 'ds-1',
      status: 'CANCELLED',
      mode: 'STORED',
      baselineRunId: null,
      createdBy: 'admin',
      summary: { cancelled: true },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:01:00.000Z',
      results: [],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    expect(screen.getByText('已取消')).toBeTruthy();
    expect(screen.getByText('本次运行已取消，未处理剩余用例。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消运行' })).toBeNull();
  });

  it('renders explicit RAG stat cards and a recent flags table', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(stats));
    render(<AiQualityPage />);
    openTab('知识质量');

    expect(screen.getByText('文档总数')).toBeTruthy();
    expect(screen.getByText('待复核')).toBeTruthy();
    expect(screen.getByText('优秀')).toBeTruthy();
    expect(screen.getByText('良好')).toBeTruthy();
    expect(screen.getByText('一般')).toBeTruthy();
    expect(screen.getByText('可疑')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getByText('退换货政策')).toBeTruthy();
    expect(screen.queryByText(/byScore/)).toBeNull();
  });

  it('shows actionable zero-hit guidance and no raw JSON', async () => {
    mockUseRequest.mockReturnValue(makeUseRequest(stats));
    mockRagSearch.mockResolvedValue({ results: [], debug: { secret: 'raw' } });
    render(<AiQualityPage />);
    openTab('知识质量');

    fireEvent.change(screen.getByPlaceholderText('检索问题'), {
      target: { value: '优惠券怎么领' },
    });
    fireEvent.click(screen.getByRole('button', { name: '检索' }));

    await waitFor(() =>
      expect(screen.getByText('没有检索到相关文档')).toBeTruthy(),
    );
    expect(screen.getByText(/文档缺失/)).toBeTruthy();
    expect(screen.getByText(/文档未启用/)).toBeTruthy();
    expect(screen.getByText(/领域不匹配/)).toBeTruthy();
    expect(screen.getByText(/问题过窄或口语化/)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: '去知识库检查/补充文档' })
        .getAttribute('href'),
    ).toBe('/knowledge');
    expect(screen.queryByText(/原始检索结果/)).toBeNull();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it('shows a RAG stats error banner instead of an empty card set', () => {
    mockUseRequest.mockReturnValue({
      ...makeUseRequest(undefined),
      error: new Error('stats down'),
    });
    render(<AiQualityPage />);
    openTab('知识质量');

    expect(screen.getByText('知识质量统计加载失败，请重试')).toBeTruthy();
    expect(screen.queryByText('暂无知识库文档质量数据。')).toBeNull();
  });
});
