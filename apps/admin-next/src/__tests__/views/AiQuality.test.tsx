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
const mockGetFeatures = vi.hoisted(() => vi.fn());
const mockGetFeedbackList = vi.hoisted(() => vi.fn());
const mockGetFeedbackSummary = vi.hoisted(() => vi.fn());
const mockUpdateFeedback = vi.hoisted(() => vi.fn());
const mockListDatasets = vi.hoisted(() => vi.fn());
const mockAddCases = vi.hoisted(() => vi.fn());
const mockUpdateCase = vi.hoisted(() => vi.fn());
const mockGetDataset = vi.hoisted(() => vi.fn());
const mockGetRun = vi.hoisted(() => vi.fn());
const mockGetRunDiff = vi.hoisted(() => vi.fn());
const mockGetCaseHistory = vi.hoisted(() => vi.fn());
const mockGetRunCalibration = vi.hoisted(() => vi.fn());
const mockStartRun = vi.hoisted(() => vi.fn());
const mockCancelRun = vi.hoisted(() => vi.fn());
const mockRagSearch = vi.hoisted(() => vi.fn());
const mockQualityStats = vi.hoisted(() => vi.fn());
const mockGetChunksDiff = vi.hoisted(() => vi.fn());
const mockCanTriage = vi.hoisted(() => vi.fn(() => true));
const mockKbStatus = vi.hoisted(() => vi.fn());
const mockRole = vi.hoisted(() => ({ current: 'ADMIN' }));
const mockAdminId = vi.hoisted(() => ({ current: 'admin-1' }));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: {
    getFeatures: mockGetFeatures,
  },
  chatApi: {
    getFeedbackList: (...args: unknown[]) => mockGetFeedbackList(...args),
    getFeedbackSummary: (...args: unknown[]) => mockGetFeedbackSummary(...args),
  },
  aiQualityApi: {
    updateFeedback: (...args: unknown[]) => mockUpdateFeedback(...args),
    listDatasets: (...args: unknown[]) => mockListDatasets(...args),
    getDataset: (...args: unknown[]) => mockGetDataset(...args),
    createDataset: vi.fn(),
    addCases: (...args: unknown[]) => mockAddCases(...args),
    updateCase: (...args: unknown[]) => mockUpdateCase(...args),
    startRun: (...args: unknown[]) => mockStartRun(...args),
    getRun: (...args: unknown[]) => mockGetRun(...args),
    getRunDiff: (...args: unknown[]) => mockGetRunDiff(...args),
    getCaseHistory: (...args: unknown[]) => mockGetCaseHistory(...args),
    getRunCalibration: (...args: unknown[]) => mockGetRunCalibration(...args),
    cancelRun: (...args: unknown[]) => mockCancelRun(...args),
    ragSearch: (...args: unknown[]) => mockRagSearch(...args),
    kbRegressionStatus: mockKbStatus,
  },
  knowledgeApi: {
    qualityStats: (...args: unknown[]) => mockQualityStats(...args),
    getChunksDiff: (...args: unknown[]) => mockGetChunksDiff(...args),
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
  claimedBy: null,
  claimedAt: null,
  version: 3,
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
  byReviewStatus: [
    { status: 'PENDING', count: 7 },
    { status: 'REVIEWED', count: 4 },
    { status: 'IGNORED', count: 1 },
  ],
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

const kbRegressionStatus = {
  currentFingerprint: 'f'.repeat(64),
  generatedAt: '2026-01-01T00:00:00.000Z',
  covered: true,
  needsFullRun: false,
  baseline: {
    runId: 'run-baseline',
    fingerprint: 'f'.repeat(64),
    finishedAt: '2026-01-01T00:00:00.000Z',
  },
  changedDocs: [],
  affectedCaseIds: [],
  affectedCaseCount: 0,
  uncoveredDocIds: [],
  pendingActivation: [],
  lastSubsetRun: null,
};

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

const harnessDatasets = [
  {
    id: 'e2e-1',
    name: 'e2e:54e7ac269671',
    description: null,
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    _count: { cases: 40, runs: 1 },
  },
];

const harnessDatasetDetail = {
  ...harnessDatasets[0],
  cases: [
    {
      id: 'case-e1',
      datasetId: 'e2e-1',
      question: '怎么退款',
      answer: '',
      expect: {},
      expected: ['doc-1'],
      tags: ['knowledge'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  runs: [
    {
      id: 'ext-run-1',
      datasetId: 'e2e-1',
      status: 'COMPLETED',
      mode: 'EXTERNAL',
      baselineRunId: null,
      createdBy: 'admin',
      summary: {
        total: 23,
        correct: 22,
        incorrect: 1,
        judgeError: 0,
        accuracy: 0.9565,
      },
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T01:00:00.000Z',
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
        ...makeUseRequest(
          options.summaryData !== undefined ? options.summaryData : summary,
        ),
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
 * EvalPanel 每轮渲染注册 7 个 useRequest（开关 / 列表 / 详情 / 运行 / 证据 / 差异 / 校准），
 * 其中开关按 service 身份识别、不占数据槽位（6 个数据槽位）；
 * 反馈页 4 个槽位（features/summary/list/datasets）；
 * 回归状态卡片单独按 service 身份识别，不参与槽位计数。
 * 返回的函数在打开页签前调用。
 */
function wireEvalTab(
  detail: unknown,
  runData: unknown = null,
  datasetsData: unknown = datasets,
  kbStatusData: unknown = kbRegressionStatus,
  diffData: unknown = null,
  calibrationData: unknown = null,
  features: { feedbackUiEnabled: boolean; evalEnabled: boolean } = {
    feedbackUiEnabled: true,
    evalEnabled: true,
  },
) {
  let index = 0;
  let inEval = false;
  mockUseRequest.mockImplementation((service: unknown) => {
    if (service === mockKbStatus) return makeUseRequest(kbStatusData);
    if (typeof service === 'function') void (service as () => unknown)();
    // 评测页的开关 hook 按所属页面识别：它先于六个数据 hook 注册，但不占数据槽位。
    if (inEval && service === mockGetFeatures) return makeUseRequest(features);
    if (!inEval) {
      const slot = index % 4;
      index += 1;
      if (slot === 0)
        return {
          ...makeUseRequest(features),
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
    const slot = index % 6;
    index += 1;
    if (slot === 0) return makeUseRequest(datasetsData);
    if (slot === 1) return makeUseRequest(detail);
    if (slot === 2) return makeUseRequest(runData);
    if (slot === 3) return makeUseRequest(null);
    if (slot === 4) return makeUseRequest(diffData);
    return makeUseRequest(calibrationData);
  });
  return () => {
    inEval = true;
    // 反馈页卸载后，评测页从自己的第一个 hook 重新计数。
    index = 0;
  };
}

/**
 * 运行状态会随轮询/取消变化：run hook 返回 getter 的当前值，
 * 数据集列表与数据集详情各挂一个 refresh spy，用来数「终态刷新」次数。
 */
function wireEvalTransitions(
  detail: unknown,
  getRunData: () => unknown,
  refreshDataset: () => void,
  refreshDatasets: () => void,
) {
  let index = 0;
  let inEval = false;
  mockUseRequest.mockImplementation((service: unknown) => {
    if (service === mockKbStatus) return makeUseRequest(kbRegressionStatus);
    if (typeof service === 'function') void (service as () => unknown)();
    if (inEval && service === mockGetFeatures)
      return makeUseRequest({ feedbackUiEnabled: true, evalEnabled: true });
    if (!inEval) {
      const slot = index % 4;
      index += 1;
      if (slot === 0)
        return makeUseRequest({ feedbackUiEnabled: true, evalEnabled: true });
      if (slot === 1) return makeUseRequest(summary);
      if (slot === 2)
        return makeUseRequest({ list: [feedback], total: 1 });
      return makeUseRequest(datasets);
    }
    const slot = index % 6;
    index += 1;
    if (slot === 0)
      return { ...makeUseRequest(datasets), refresh: refreshDatasets };
    if (slot === 1)
      return { ...makeUseRequest(detail), refresh: refreshDataset };
    if (slot === 2) return makeUseRequest(getRunData());
    return makeUseRequest(null);
  });
  return () => {
    inEval = true;
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
    mockGetFeatures.mockResolvedValue({
      feedbackUiEnabled: true,
      evalEnabled: true,
    });
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

  it('把 URL 的日期转成本地日界 ISO 区间后请求', () => {
    (useSearchParams as any).mockReturnValue(
      new URLSearchParams('from=2026-11-24&to=2026-11-25'),
    );

    render(<AiQualityPage />);

    const expected = {
      from: new Date(2026, 10, 24, 0, 0, 0, 0).toISOString(),
      to: new Date(
        new Date(2026, 10, 26, 0, 0, 0, 0).getTime() - 1,
      ).toISOString(),
    };
    expect(mockGetFeedbackList).toHaveBeenCalledWith(
      expect.objectContaining(expected),
    );
    expect(mockGetFeedbackSummary).toHaveBeenCalledWith(expected);
  });

  it('KPI cards link to the matching filtered list', () => {    render(<AiQualityPage />);

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
        expectedVersion: 3,
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
        expectedVersion: 3,
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
        expectedVersion: 3,
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
        expectedVersion: 3,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-confirmed', {
        resolution: 'CLOSED',
        expectedVersion: 3,
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
        expectedVersion: 3,
      }),
    );
    expect(screen.getByText('已认领，负责人是你')).toBeTruthy();
  });

  it('takes over a row claimed by another admin with takeOver=true', async () => {
    wireFeedback({
      listData: {
        list: [{ ...feedback, claimedBy: 'admin-2', ownerAdminId: 'admin-2' }],
        total: 1,
      },
    });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    const card = screen.getByText(/质检 1 \/ 1/).closest('section')!;
    expect(within(card).getByText('负责人：管理员（admin-2）')).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: '接手' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        ownerAdminId: 'admin-1',
        expectedVersion: 3,
        takeOver: true,
      }),
    );
    expect(screen.getByText('已接手，负责人是你')).toBeTruthy();
  });

  it('disables the claim button when the current admin already owns the row', () => {
    wireFeedback({
      listData: {
        list: [{ ...feedback, claimedBy: 'admin-1', ownerAdminId: 'admin-1' }],
        total: 1,
      },
    });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    const card = screen.getByText(/质检 1 \/ 1/).closest('section')!;
    const claim = within(card).getByRole('button', {
      name: '已认领',
    }) as HTMLButtonElement;
    expect(claim.disabled).toBe(true);
  });

  it('refreshes and explains when triage hits a version conflict', async () => {
    mockUpdateFeedback.mockRejectedValueOnce({
      status: 409,
      message: 'Feedback changed since it was loaded',
    });
    wireFeedback();
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '开始质检' }));
    const card = screen.getByText(/质检 1 \/ 1/).closest('section')!;
    const listCallsBefore = mockGetFeedbackList.mock.calls.length;
    fireEvent.click(within(card).getByRole('button', { name: '确认问题' }));

    await waitFor(() =>
      expect(
        screen.getByText('这条反馈刚被他人更新，列表已刷新，请重试'),
      ).toBeTruthy(),
    );
    // 冲突后必须重新拉列表，拿新版本再让用户重试
    expect(mockGetFeedbackList.mock.calls.length).toBeGreaterThan(
      listCallsBefore,
    );
  });

  it('shows the specific outcome for REVIEWED rows instead of a generic confirmed label', () => {
    wireFeedback({
      listData: {
        list: [
          {
            ...feedback,
            id: 'fb-closed',
            reviewStatus: 'REVIEWED',
            resolution: 'CLOSED',
          },
          {
            ...feedback,
            id: 'fb-eval',
            reviewStatus: 'REVIEWED',
            resolution: 'ADDED_TO_EVAL',
          },
        ],
        total: 2,
      },
    });
    render(<AiQualityPage />);

    const closed = screen.getByText('已关闭').closest('tr')!;
    expect(within(closed).queryByText('已确认')).toBeNull();
    expect(screen.getAllByText('已进回归').length).toBeGreaterThan(0);
  });

  it('shows claim as a separate column from the completion outcome', () => {
    wireFeedback({
      listData: {
        list: [
          {
            ...feedback,
            id: 'fb-claimed',
            reviewStatus: 'PENDING',
            resolution: 'OPEN',
            claimedBy: 'admin-1',
            ownerAdminId: 'admin-1',
          },
        ],
        total: 1,
      },
    });
    render(<AiQualityPage />);

    const row = within(screen.getByRole('table'))
      .getByText('待处理')
      .closest('tr')!;
    // 认领不等于处理完成：状态仍是待处理，负责人单独展示
    expect(within(row).queryByText('已确认')).toBeNull();
    expect(within(row).getByText('我')).toBeTruthy();
  });

  it('shows counts on the triage and resolution filters', () => {
    render(<AiQualityPage />);

    expect(
      screen.getByRole('option', { name: '待处理（7）' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: '已确认（4）' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: '已进回归（4）' }),
    ).toBeTruthy();
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
      expectedVersion: 3,
    });
    expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-svc-2', {
      reviewStatus: 'IGNORED',
      resolution: 'EXCLUDED',
      failureKind: 'SERVICE_ERROR',
      expectedVersion: 3,
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
        expectedVersion: 3,
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

    // 评测页的写入口依赖开关；其余请求仍按空数据返回。
    mockUseRequest.mockImplementation((service: unknown) =>
      service === mockGetFeatures
        ? makeUseRequest({ feedbackUiEnabled: true, evalEnabled: true })
        : makeUseRequest([]),
    );
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

  it('汇总请求失败时 KPI 显示未知，不用破折号或 0 冒充', () => {
    wireFeedback({ summaryData: null, summaryError: new Error('summary down') });
    render(<AiQualityPage />);

    const pending = screen.getByRole('link', { name: '待处理，查看对应反馈' });
    expect(within(pending).getByText('未知')).toBeTruthy();
    expect(within(pending).queryByText('—')).toBeNull();
  });

  it('shows the empty state only when the request has no error', () => {
    wireFeedback({ listData: { list: [], total: 0 } });
    render(<AiQualityPage />);

    expect(screen.getByText('暂无反馈')).toBeTruthy();
  });

  it('keeps the JSON import behind a collapsed advanced-mode toggle', () => {
    mockUseRequest.mockImplementation((service: unknown) =>
      service === mockGetFeatures
        ? makeUseRequest({ feedbackUiEnabled: true, evalEnabled: true })
        : makeUseRequest(datasets),
    );
    render(<AiQualityPage />);
    openTab('回归测试');

    expect(screen.queryByLabelText('评测用例 JSON')).toBeNull();
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '高级模式' }));

    expect(screen.getByLabelText('评测用例 JSON')).toBeTruthy();
  });

  it('用例总数取 casesTotal，而不是当前页数组长度', () => {
    const enterEval = wireEvalTab({
      ...evalDatasetDetail,
      casesTotal: 120,
      _count: { cases: 120, runs: 2 },
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    expect(screen.getByText('用例（120）')).toBeTruthy();
    expect(screen.getAllByText('120').length).toBeGreaterThan(0);
  });

  it('分页后加入回归用 createdCases 关联，不依赖当前页', async () => {
    mockAddCases.mockResolvedValue({
      id: 'ds-1',
      cases: [evalDatasetDetail.cases[0]],
      created: 1,
      skipped: [],
      createdCases: [{ id: 'case-new', question: feedback.input }],
    });
    mockUpdateFeedback.mockResolvedValue({});
    wireFeedback();
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '加入回归' }));
    fireEvent.change(screen.getByLabelText('选择回归评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认加入回归' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith(
        'fb-1',
        expect.objectContaining({ linkedEvalCaseId: 'case-new' }),
      ),
    );
  });

  it('导入用例按 created 与 skipped 报数', async () => {
    mockAddCases.mockResolvedValue({
      id: 'ds-1',
      cases: [],
      created: 1,
      skipped: [{ question: '重复问题', reason: 'DUPLICATE_IN_DATASET' }],
    });
    const enterEval = wireEvalTab(evalDatasetDetail);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '高级模式' }));
    fireEvent.change(screen.getByLabelText('评测用例 JSON'), {
      target: {
        value: JSON.stringify([
          { question: '新问题', answer: 'a' },
          { question: '重复问题', answer: 'b' },
        ]),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '导入用例' }));

    await waitFor(() =>
      expect(screen.getByText('已添加 1 条用例，跳过 1 条重复')).toBeTruthy(),
    );
  });

  it('用例编辑以 expect 为准，expected 只做只读展示', () => {
    const detail = {
      ...evalDatasetDetail,
      cases: [
        {
          id: 'case-expect',
          datasetId: 'ds-1',
          question: '退款多久到账',
          answer: '客服回答',
          expect: {
            mustMention: ['3 个工作日', '原路退回'],
            confirmAction: 'order.refund',
            forbidExecution: true,
            intent: 'refund',
          },
          expected: '旧的期望答案',
          tags: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const enterEval = wireEvalTab(detail);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    expect(
      screen.getByText(/判分条件（expect）：3 个工作日；原路退回/),
    ).toBeTruthy();
    expect(
      screen.getByText('确认动作：order.refund · 禁止执行：是 · 意图：refund'),
    ).toBeTruthy();
    expect(
      screen.getByText('兼容字段 expected（只读）：旧的期望答案'),
    ).toBeTruthy();
  });

  it('行内编辑器按行展示 mustMention，并带 DTO 同口径 maxLength', () => {
    const detail = {
      ...evalDatasetDetail,
      cases: [
        {
          ...evalDatasetDetail.cases[0],
          id: 'case-edit',
          expect: { mustMention: ['3 个工作日', '原路退回'] },
        },
      ],
    };
    const enterEval = wireEvalTab(detail);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: '编辑期望' }));

    const textarea = screen.getByLabelText('必含关键词');
    expect((textarea as HTMLTextAreaElement).value).toBe(
      '3 个工作日\n原路退回',
    );
    expect((textarea as HTMLTextAreaElement).maxLength).toBe(20 * 501);
  });

  it('保存判分条件只提交 expect，并保留非文本条件', async () => {
    mockUpdateCase.mockResolvedValue({});
    const detail = {
      ...evalDatasetDetail,
      cases: [
        {
          ...evalDatasetDetail.cases[0],
          id: 'case-save',
          expect: {
            mustMention: ['3 个工作日'],
            confirmAction: 'order.refund',
            intent: 'refund',
          },
          expected: '旧回答',
        },
      ],
    };
    const enterEval = wireEvalTab(detail);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: '编辑期望' }));
    fireEvent.change(screen.getByLabelText('必含关键词'), {
      target: { value: '3 个工作日\n新的要点' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存判分条件' }));

    await waitFor(() => expect(mockUpdateCase).toHaveBeenCalled());
    const payload = mockUpdateCase.mock.calls[0][2];
    expect(mockUpdateCase.mock.calls[0].slice(0, 2)).toEqual([
      'ds-1',
      'case-save',
    ]);
    expect(payload).toEqual({
      expect: {
        mustMention: ['3 个工作日', '新的要点'],
        confirmAction: 'order.refund',
        intent: 'refund',
      },
    });
    expect('expected' in payload).toBe(false);
  });

  it('超过 20 条必含关键词时在本地拦截，不打接口', () => {
    const enterEval = wireEvalTab({
      ...evalDatasetDetail,
      cases: [{ ...evalDatasetDetail.cases[0], id: 'case-too-many' }],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: '编辑期望' }));
    fireEvent.change(screen.getByLabelText('必含关键词'), {
      target: {
        value: Array.from({ length: 21 }, (_, i) => `要点${i}`).join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存判分条件' }));

    expect(screen.getByText('最多 20 条必含关键词')).toBeTruthy();
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it('用例列表分页：下一页请求第 2 页', () => {
    const enterEval = wireEvalTab({
      ...evalDatasetDetail,
      casesTotal: 120,
      page: 1,
      pageSize: 50,
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    expect(screen.getByText('第 1 / 3 页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    expect(mockGetDataset).toHaveBeenCalledWith('ds-1', { page: 2 });
  });

  it('终态运行的结果可以翻页', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'LIVE',
      createdBy: 'admin',
      summary: { total: 120 },
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T01:00:00.000Z',
      resultsTotal: 120,
      page: 1,
      pageSize: 50,
      results: [
        {
          id: 'r-1',
          verdict: 'solved',
          score: 1,
          reason: 'ok',
          latencyMs: 10,
          case: evalDatasetDetail.cases[0],
        },
      ],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockStartRun.mockResolvedValueOnce({ id: 'run-1', status: 'RUNNING' });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启动批量评测' }));
    await waitFor(() => expect(mockGetRun).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() =>
      expect(mockGetRun).toHaveBeenCalledWith('run-1', { page: 2 }),
    );
  });

  it('运行中只取第 1 页，且不提供结果翻页', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-1',
      datasetId: 'ds-1',
      status: 'RUNNING',
      mode: 'LIVE',
      createdBy: 'admin',
      summary: { total: 200, processed: 60 },
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      resultsTotal: 200,
      page: 1,
      pageSize: 50,
      results: [],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockStartRun.mockResolvedValueOnce({ id: 'run-1', status: 'RUNNING' });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启动批量评测' }));

    await waitFor(() =>
      expect(mockGetRun).toHaveBeenCalledWith('run-1', { page: 1 }),
    );
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  });

  it('shows accuracy instead of pass rate for an EXTERNAL run', () => {
    const enterEval = wireEvalTab(harnessDatasetDetail, null, harnessDatasets);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'e2e-1' },
    });

    expect(screen.getByText('最近一次准确率')).toBeTruthy();
    expect(screen.getByText('95.7%（已完成）')).toBeTruthy();
  });

  it('labels the last subset run as accuracy on the KB card', () => {
    const enterEval = wireEvalTab(evalDatasetDetail, null, datasets, {
      ...kbRegressionStatus,
      covered: false,
      lastSubsetRun: {
        id: 'subset-run',
        finishedAt: '2026-01-01T02:00:00.000Z',
        fingerprint: 'f'.repeat(64),
        stable: true,
        summary: { total: 12, accuracy: 0.9 },
      },
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    expect(document.body.textContent).toContain('准确率 90.0%');
  });

  it('renders an e2e dataset as read-only', () => {
    const enterEval = wireEvalTab(harnessDatasetDetail, null, harnessDatasets);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'e2e-1' },
    });

    expect(screen.getByText('harness 数据集 · 只读')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '启动批量评测' })).toBeNull();
    expect(screen.queryByLabelText('评测模式')).toBeNull();
    expect(screen.queryByLabelText(/对比基线/)).toBeNull();
    expect(screen.queryByRole('button', { name: '编辑期望' })).toBeNull();
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
    expect(screen.queryByRole('button', { name: '高级模式' })).toBeNull();
    expect(screen.getByText('怎么退款')).toBeTruthy();
  });

  it('keeps an e2e dataset read-only before its detail loads', () => {
    const enterEval = wireEvalTab(null, null, harnessDatasets);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'e2e-1' },
    });

    expect(screen.queryByRole('button', { name: '启动批量评测' })).toBeNull();
    expect(screen.getByText('harness 数据集 · 只读')).toBeTruthy();
  });

  it('keeps write controls for a normal dataset', () => {
    const enterEval = wireEvalTab(evalDatasetDetail);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    expect(screen.getByRole('button', { name: '启动批量评测' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑期望' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy();
    expect(screen.queryByText('harness 数据集 · 只读')).toBeNull();
  });

  it('hides the JSON import when switching to an e2e dataset with advanced mode open', () => {
    const enterEval = wireEvalTab(evalDatasetDetail, null, [
      ...datasets,
      ...harnessDatasets,
    ]);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '高级模式' }));
    expect(screen.getByLabelText('评测用例 JSON')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'e2e-1' },
    });

    expect(screen.queryByLabelText('评测用例 JSON')).toBeNull();
    expect(screen.queryByRole('button', { name: '高级模式' })).toBeNull();
    expect(screen.getByText('harness 数据集 · 只读')).toBeTruthy();
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

  it('双击启动只调用一次接口', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolveStart: (value: unknown) => void = () => {};
    mockStartRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    const button = screen.getByRole('button', { name: '启动批量评测' });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(mockStartRun).toHaveBeenCalledTimes(1));
    resolveStart({ id: 'run-new', status: 'RUNNING' });
  });

  it('启动撞上已有运行时显示「已有运行」而不是原始 409', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockStartRun.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          message: 'This dataset already has a run in progress',
          runId: 'run-existing',
        },
      },
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启动批量评测' }));

    expect(await screen.findByText(/已有运行/)).toBeTruthy();
    expect(screen.queryByText(/request failed/i)).toBeNull();
  });

  it('运行卡展示运行标识、范围、指标族、进度与失败类别', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-detail-1',
      datasetId: 'ds-1',
      status: 'FAILED',
      mode: 'STORED',
      scope: 'full',
      metricFamily: 'verdict3',
      baselineRunId: null,
      createdBy: 'admin',
      summary: {
        total: 20,
        processed: 18,
        judged: 16,
        failureCategory: 'judge_unavailable',
      },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:10:00.000Z',
      results: [],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /base-run/ }));
    await waitFor(() => expect(mockGetRun).toHaveBeenCalled());

    expect(screen.getByText(/运行 ID：run-detail-1/)).toBeTruthy();
    expect(screen.getByText(/运行范围：全量/)).toBeTruthy();
    expect(screen.getByText(/指标族：verdict3/)).toBeTruthy();
    expect(screen.getByText(/已处理 18 \/ 共 20/)).toBeTruthy();
    expect(screen.getByText(/失败类别：judge_unavailable/)).toBeTruthy();
  });

  it('汇总缺字段时显示未记录，不用 0 冒充未知', async () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-gap-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'EXTERNAL',
      baselineRunId: null,
      createdBy: 'admin',
      summary: { total: 3 },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:10:00.000Z',
      results: [],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /base-run/ }));
    await waitFor(() => expect(mockGetRun).toHaveBeenCalled());

    expect(
      screen.getByText(/正确 未记录 · 错误 未记录 · 判官失败 未记录/),
    ).toBeTruthy();
  });

  it('未采集依据分型的结果标未检查', () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-gap-2',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'EXTERNAL',
      baselineRunId: null,
      createdBy: 'admin',
      summary: { total: 1, correct: 1 },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:10:00.000Z',
      results: [
        {
          id: 'r-ground-1',
          answerVerdict: 'correct',
          answerScore: 0.9,
          grounding: null,
          reason: 'ok',
          latencyMs: 12,
          case: evalDatasetDetail.cases[0],
        },
      ],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /base-run/ }));

    expect(screen.getByText(/依据分型：未检查/)).toBeTruthy();
  });

  it('推断出的行诊断标注推断', () => {
    render(<AiQualityPage />);

    // 默认列表行没有 traceId，诊断是推断出来的，必须与已核实结论区分。
    expect(screen.getByText(/无链路 · 推断/)).toBeTruthy();
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

  it('baseline dropdown reads accuracy for EXTERNAL runs and pass rate for internal runs', () => {
    const detailWithMixedRuns = {
      ...evalDatasetDetail,
      runs: [
        {
          id: 'internal-run-1',
          datasetId: 'ds-1',
          status: 'COMPLETED',
          mode: 'LIVE',
          baselineRunId: null,
          createdBy: 'admin',
          summary: { passRate: 0.5, total: 2, solved: 1 },
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T01:00:00.000Z',
        },
        {
          id: 'external-run-1',
          datasetId: 'ds-1',
          status: 'COMPLETED',
          mode: 'EXTERNAL',
          scope: 'full',
          baselineRunId: null,
          createdBy: 'admin',
          summary: { accuracy: 0.9, total: 20, correct: 9 },
          startedAt: '2026-01-02T00:00:00.000Z',
          finishedAt: '2026-01-02T01:00:00.000Z',
        },
      ],
    };
    const enterEval = wireEvalTab(detailWithMixedRuns);
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });

    const select = screen.getByLabelText('对比基线') as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.text);
    // 内部 run 读 passRate，EXTERNAL run 读 accuracy，同一 key 不跨族顶替。
    expect(options).toContain('internal · 50.0%（通过率）');
    expect(options).toContain('external · 90.0%（准确率）');
  });

  it('shows judge failure accounting, valid pass rate, sample count and run scope', () => {
    const enterEval = wireEvalTab(evalDatasetDetail, {
      id: 'run-judge-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'LIVE',
      scope: 'full',
      baselineRunId: null,
      createdBy: 'admin',
      metricFamily: 'verdict3',
      metricSpecVersion: 'verdict3-1',
      judgeSampleCount: 1,
      executionErrorKind: null,
      summary: {
        total: 10,
        processed: 10,
        judged: 8,
        solved: 6,
        partial: 1,
        unsolved: 1,
        judgeErrors: 2,
        // 内部运行存的是 Record<kind, count>，不是 EXTERNAL 的数组
        judgeErrorKinds: { timeout: 2 },
        executionErrors: 0,
        passRate: 0.6,
        validPassRate: 0.75,
        judgeErrorRate: 0.2,
        executionErrorRate: 0,
        metricFamily: 'verdict3',
        metricSpecVersion: 'verdict3-1',
        failureCategory: null,
      },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:10:00.000Z',
      results: [],
    });
    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');

    // 通过率的分母没有变（solved/total），另外单独给出判过才统计的口径
    expect(screen.getByText('通过率 60.0%')).toBeTruthy();
    expect(screen.getByText(/有效通过率 75\.0%/)).toBeTruthy();
    expect(screen.getByText(/已处理 10 \/ 共 10/)).toBeTruthy();
    expect(screen.getByText(/已判定 8/)).toBeTruthy();
    expect(screen.getByText(/判官失败率 20\.0%/)).toBeTruthy();
    expect(screen.getByText(/判官失败类型 timeout 2/)).toBeTruthy();
    expect(screen.getByText(/运行范围：全量/)).toBeTruthy();
    expect(screen.getByText(/运行 ID：run-judge-1/)).toBeTruthy();
    expect(screen.getByText(/判官采样 1 次\/条/)).toBeTruthy();
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

  const runningRun = {
    id: 'run-1',
    datasetId: 'ds-1',
    status: 'RUNNING',
    mode: 'LIVE',
    baselineRunId: null,
    createdBy: 'admin',
    summary: { total: 10 },
    startedAt: '2026-01-02T00:00:00.000Z',
    finishedAt: null,
    results: [],
  };

  it('运行进入终态后刷新数据集与基线下拉各一次', async () => {
    const refreshDataset = vi.fn();
    const refreshDatasets = vi.fn();
    let currentRun: any = { ...runningRun };
    const enterEval = wireEvalTransitions(
      evalDatasetDetail,
      () => currentRun,
      refreshDataset,
      refreshDatasets,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockStartRun.mockResolvedValueOnce({ id: 'run-1', status: 'RUNNING' });

    const { rerender } = render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启动批量评测' }));
    await waitFor(() => expect(mockGetRun).toHaveBeenCalled());

    currentRun = {
      ...currentRun,
      status: 'COMPLETED',
      finishedAt: '2026-01-02T00:10:00.000Z',
    };
    rerender(<AiQualityPage />);

    await waitFor(() => expect(refreshDataset).toHaveBeenCalledTimes(1));
    expect(refreshDatasets).toHaveBeenCalledTimes(1);
  });

  it('打开历史终态运行不触发刷新', async () => {
    const refreshDataset = vi.fn();
    const refreshDatasets = vi.fn();
    const enterEval = wireEvalTransitions(
      evalDatasetDetail,
      () => ({
        ...runningRun,
        id: 'base-run-1',
        status: 'COMPLETED',
        finishedAt: '2026-01-01T01:00:00.000Z',
      }),
      refreshDataset,
      refreshDatasets,
    );

    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /base-run/ }));

    await waitFor(() =>
      expect(mockGetRun).toHaveBeenCalledWith('base-run-1', { page: 1 }),
    );
    expect(refreshDataset).not.toHaveBeenCalled();
    expect(refreshDatasets).not.toHaveBeenCalled();
  });

  it('取消成功也刷新数据集与基线下拉各一次', async () => {
    const refreshDataset = vi.fn();
    const refreshDatasets = vi.fn();
    const enterEval = wireEvalTransitions(
      evalDatasetDetail,
      () => ({ ...runningRun, id: 'running-run' }),
      refreshDataset,
      refreshDatasets,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockCancelRun.mockResolvedValueOnce({ id: 'running-run', status: 'CANCELLED' });

    render(<AiQualityPage />);
    enterEval();
    openTab('回归测试');
    fireEvent.change(screen.getByLabelText('选择评测集'), {
      target: { value: 'ds-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消运行' }));

    await waitFor(() => expect(refreshDataset).toHaveBeenCalledTimes(1));
    expect(refreshDatasets).toHaveBeenCalledTimes(1);
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

  it('分块对比调用服务端 diff 并展示新增/删除/修改', async () => {
    const diff = {
      currentVersion: 2,
      previousVersion: 1,
      summary: { added: 1, removed: 1, modified: 1, unchanged: 0 },
      changes: [
        {
          chunkIndex: 0,
          change: 'modified',
          previous: { content: '改前' },
          current: { content: '改后' },
        },
        {
          chunkIndex: 1,
          change: 'added',
          previous: null,
          current: { content: '新增内容' },
        },
        {
          chunkIndex: 2,
          change: 'removed',
          previous: { content: '已删内容' },
          current: null,
        },
      ],
    };
    mockGetChunksDiff.mockResolvedValue(diff);
    mockUseRequest.mockImplementation((service: unknown) => {
      if (typeof service === 'function') {
        const before = mockGetChunksDiff.mock.calls.length;
        void (service as () => unknown)();
        if (mockGetChunksDiff.mock.calls.length > before) {
          return makeUseRequest(diff);
        }
      }
      return makeUseRequest(stats);
    });
    render(<AiQualityPage />);
    openTab('知识质量');

    fireEvent.click(screen.getByRole('button', { name: '新旧分块' }));

    await waitFor(() =>
      expect(mockGetChunksDiff).toHaveBeenCalledWith('doc-1'),
    );
    expect(screen.getByText(/新增 1/)).toBeTruthy();
    expect(screen.getByText(/删除 1/)).toBeTruthy();
    expect(screen.getByText(/修改 1/)).toBeTruthy();
    expect(screen.getByText('改前')).toBeTruthy();
    expect(screen.getByText('改后')).toBeTruthy();
    expect(screen.getByText('新增内容')).toBeTruthy();
    expect(screen.getByText('已删内容')).toBeTruthy();
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
    // 请求失败不能被读成「确实没有记录」。
    expect(screen.queryByText('暂无更新记录')).toBeNull();
    expect(screen.queryByText('暂无标记文档')).toBeNull();
  });

  it('知识统计字段缺失时显示未知，不用破折号冒充', () => {
    mockQualityStats.mockResolvedValue({ total: 10 });
    mockUseRequest.mockImplementation((service: unknown) => {
      if (service === mockKbStatus) return makeUseRequest(kbRegressionStatus);
      if (typeof service === 'function') void (service as () => unknown)();
      return makeUseRequest({ total: 10 });
    });
    render(<AiQualityPage />);
    openTab('知识质量');

    const excellent = screen.getByText('优秀').parentElement;
    expect(within(excellent as HTMLElement).getByText('未知')).toBeTruthy();
    expect(within(excellent as HTMLElement).queryByText('—')).toBeNull();
  });

  describe('知识质量分区分解析质量与有效性', () => {
    const parseChecks = {
      truncation: { passed: true, detail: '结尾完整' },
      retentionRate: { passed: false, rate: 62, detail: '保留率偏低' },
      encoding: { passed: true, detail: '无乱码' },
      emptyContent: { passed: true, detail: '内容非空' },
    };

    function renderKnowledgeTab() {
      mockUseRequest.mockReturnValue(
        makeUseRequest({
          ...stats,
          parseQuality: { collected: 1, passed: 0, failed: 1, notCollected: 1 },
          effectiveness: {
            status: 'pendingMetric',
            collected: false,
            note: '检索命中与引用正确率尚未采集，不参与评分。',
          },
          recentUpdated: [
            {
              documentId: 'doc-1',
              title: '退换货政策',
              score: 75,
              flags: 'low_retention',
              activeVersion: 2,
              version: 3,
              updatedAt: '2026-01-03T00:00:00.000Z',
              parseChecks,
            },
            {
              documentId: 'doc-2',
              title: '旧文档',
              score: null,
              flags: null,
              activeVersion: 0,
              version: 1,
              updatedAt: '2026-01-01T00:00:00.000Z',
              parseChecks: null,
            },
          ],
        }),
      );
      render(<AiQualityPage />);
      openTab('知识质量');
    }

    it('展示解析通过与四项检查明细', () => {
      renderKnowledgeTab();

      expect(screen.getByText('解析通过')).toBeTruthy();
      expect(screen.getByText('解析未通过')).toBeTruthy();
      expect(screen.getByText('解析未采集')).toBeTruthy();
      expect(screen.getByTestId('parse-check-truncation').textContent).toContain(
        '截断',
      );
      expect(
        screen.getByTestId('parse-check-retentionRate').textContent,
      ).toContain('保留率');
      expect(screen.getByTestId('parse-check-encoding').textContent).toContain(
        '编码',
      );
      expect(
        screen.getByTestId('parse-check-emptyContent').textContent,
      ).toContain('内容');
      expect(screen.getByTestId('parse-check-retentionRate').textContent).toContain(
        '未通过',
      );
    });

    it('版本区分生效版本与最新写入版本', () => {
      renderKnowledgeTab();

      expect(screen.getByText('生效 v2 · 最新 v3')).toBeTruthy();
    });

    it('有效性未采集时不显示 0 或百分比', () => {
      renderKnowledgeTab();

      expect(screen.getByText('有效性')).toBeTruthy();
      // 有效性卡与无快照的旧文档都显示「未采集」，而不是 0/0%。
      expect(screen.getAllByText('未采集').length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText('0%')).toBeNull();
      expect(screen.queryByText('有效性 0')).toBeNull();
      expect(screen.getByText(/检索命中与引用正确率尚未采集/)).toBeTruthy();
    });

    it('检索调试展示 rerank 与相关性门卫结论', async () => {
      mockQualityStats.mockResolvedValue(stats);
      mockRagSearch.mockResolvedValue({
        results: [
          {
            chunkId: 'c1',
            title: '退款政策',
            score: 0.91,
            contentPreview: '7 天无理由',
            domain: 'common',
          },
        ],
        debug: {
          rerank: true,
          relevanceGate: {
            applied: true,
            threshold: 0.3,
            floor: 0.2,
            blocked: false,
            reason: 'top score above floor',
          },
        },
      });
      render(<AiQualityPage />);
      openTab('知识质量');

      fireEvent.change(screen.getByPlaceholderText('检索问题'), {
        target: { value: '退货怎么退' },
      });
      fireEvent.click(screen.getByRole('button', { name: '检索' }));

      expect(await screen.findByText(/rerank：开/)).toBeTruthy();
      expect(screen.getByText(/相关性门卫：通过/)).toBeTruthy();
      expect(screen.queryByText(/top score above floor/)).toBeNull();
    });
  });

  describe('回归用例可解释', () => {
    const runWithBaseline = {
      id: 'run-diff-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'LIVE',
      scope: 'full',
      baselineRunId: 'base-run-1',
      createdBy: 'admin',
      summary: { total: 5, solved: 4, partial: 0, unsolved: 1 },
      startedAt: '2026-01-03T00:00:00.000Z',
      finishedAt: '2026-01-03T00:10:00.000Z',
      results: [
        {
          id: 'res-h1',
          verdict: 'solved',
          score: 1,
          reason: '关键信息齐全',
          latencyMs: 5,
          case: evalDatasetDetail.cases[0],
        },
      ],
    };
    const runDiff = {
      runId: 'run-diff-1',
      baselineRunId: 'base-run-1',
      metricFamily: 'verdict3',
      comparability: { compared: 5, undecided: 1, missingBaseline: 2 },
      counts: { newFailure: 2, fixed: 1, regressed: 1, stillFailing: 3 },
      classes: { newFailure: [], fixed: [], regressed: [], stillFailing: [] },
      note: '描述性分类，不构成统计显著性结论；显著性由 compare.py 配对检验给出。',
    };

    function openWithBaselineRun(
      runData: unknown,
      diffData: unknown = runDiff,
    ) {
      const enterEval = wireEvalTab(
        { ...evalDatasetDetail, runs: [runWithBaseline] },
        runData,
        datasets,
        kbRegressionStatus,
        diffData,
      );
      render(<AiQualityPage />);
      enterEval();
      openTab('回归测试');
      fireEvent.change(screen.getByLabelText('选择评测集'), {
        target: { value: 'ds-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /run-diff/ }));
    }

    it('运行卡展示与基线的四类差异与可比性，不声称显著', async () => {
      openWithBaselineRun(runWithBaseline);

      expect(await screen.findByText('与基线差异')).toBeTruthy();
      expect(screen.getByText(/新增失败 2/)).toBeTruthy();
      expect(screen.getByText(/修复 1/)).toBeTruthy();
      expect(screen.getByText(/回退 1/)).toBeTruthy();
      expect(screen.getByText(/仍失败 3/)).toBeTruthy();
      expect(
        screen.getByText(/可比对 5 条 · 判官未判定 1 条 · 基线缺少 2 条/),
      ).toBeTruthy();
      expect(screen.getByText(/不构成统计显著性结论/)).toBeTruthy();
      await waitFor(() =>
        expect(mockGetRunDiff).toHaveBeenCalledWith('run-diff-1', 'base-run-1'),
      );
    });

    it('没有基线的运行不请求也不展示差异', async () => {
      openWithBaselineRun({
        ...runWithBaseline,
        id: 'run-diff-1',
        baselineRunId: null,
      });

      await waitFor(() => expect(mockGetRun).toHaveBeenCalled());
      expect(screen.queryByText('与基线差异')).toBeNull();
      expect(mockGetRunDiff).not.toHaveBeenCalled();
    });

    it('单条结果可展开时间线，逐次展示判定与未判定', async () => {
      mockGetCaseHistory.mockResolvedValue({
        caseId: 'case-1',
        datasetId: 'ds-1',
        case: {
          id: 'case-1',
          question: '怎么退款',
          tags: null,
          sourceFeedbackId: null,
        },
        timeline: [
          {
            runId: 'run-old',
            status: 'COMPLETED',
            mode: 'LIVE',
            scope: 'full',
            isBaseline: true,
            startedAt: '2026-01-01T00:00:00.000Z',
            verdict: 'unsolved',
            answerVerdict: null,
            judgeErrorKind: null,
            score: 0,
            answerScore: null,
            outcome: 'fail',
          },
          {
            runId: 'run-mid',
            status: 'COMPLETED',
            mode: 'LIVE',
            scope: 'full',
            isBaseline: false,
            startedAt: '2026-01-02T00:00:00.000Z',
            verdict: 'solved',
            answerVerdict: null,
            judgeErrorKind: null,
            score: 1,
            answerScore: null,
            outcome: 'pass',
          },
          {
            runId: 'run-judge',
            status: 'COMPLETED',
            mode: 'LIVE',
            scope: 'full',
            isBaseline: false,
            startedAt: '2026-01-03T00:00:00.000Z',
            verdict: null,
            answerVerdict: null,
            judgeErrorKind: 'timeout',
            score: null,
            answerScore: null,
            outcome: 'undecided',
          },
        ],
      });
      openWithBaselineRun(runWithBaseline);

      fireEvent.click(screen.getByRole('button', { name: '查看历史' }));

      await waitFor(() =>
        expect(mockGetCaseHistory).toHaveBeenCalledWith('run-diff-1', 'case-1'),
      );
      expect(
        screen.getByTestId('history-outcome-run-old').textContent,
      ).toBe('失败');
      expect(
        screen.getByTestId('history-outcome-run-mid').textContent,
      ).toBe('通过');
      expect(
        screen.getByTestId('history-outcome-run-judge').textContent,
      ).toBe('未判定');
    });

    it('待验反馈在列表展示待验徽标', () => {
      wireFeedback({
        listData: {
          list: [
            {
              ...feedback,
              reviewStatus: 'REVIEWED',
              resolution: 'FIXED_PENDING_VERIFY',
            },
          ],
          total: 1,
        },
      });
      render(<AiQualityPage />);

      expect(screen.getByText('已修复待验证')).toBeTruthy();
      expect(screen.getByText('待验')).toBeTruthy();
    });
  });

  describe('判官校准只读卡', () => {
    const completedRun = {
      id: 'run-cal-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'LIVE',
      scope: 'full',
      baselineRunId: null,
      createdBy: 'admin',
      summary: { total: 0, solved: 0, partial: 0, unsolved: 0 },
      startedAt: '2026-01-03T00:00:00.000Z',
      finishedAt: '2026-01-03T00:10:00.000Z',
      results: [],
    };

    function openWithCalibration(calibration: unknown) {
      const enterEval = wireEvalTab(
        { ...evalDatasetDetail, runs: [completedRun] },
        completedRun,
        datasets,
        kbRegressionStatus,
        null,
        calibration,
      );
      render(<AiQualityPage />);
      enterEval();
      openTab('回归测试');
      fireEvent.change(screen.getByLabelText('选择评测集'), {
        target: { value: 'ds-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /run-cal/ }));
    }

    it('样本不足时显示「样本不足」且不渲染任何百分比', async () => {
      openWithCalibration({
        runId: 'run-cal-1',
        datasetId: 'ds-1',
        metricFamily: 'verdict3',
        status: 'insufficientSample',
        threshold: 20,
        n: 10,
        excluded: 0,
        disagreements: [
          {
            caseId: 'case-1',
            question: '退货怎么退',
            judgeVerdict: 'solved',
            humanCorrectness: 'unsolved',
            judgeReason: '判官认为已给出步骤',
            humanComment: '实际没解决',
            labelerId: 'admin-1',
          },
        ],
        note: '样本不足（10/20）：不下结论，仅列出分歧明细供人工判断。',
      });

      const card = await screen.findByTestId('run-calibration');
      expect(within(card).getByText(/需 ≥20 条/)).toBeTruthy();
      expect(within(card).getByText(/样本不足（10\/20）/)).toBeTruthy();
      // 样本不足不得出现一致率百分比。
      expect(within(card).queryByText(/%/)).toBeNull();
      expect(within(card).getByText(/实际没解决/)).toBeTruthy();
    });

    it('样本充足时显示一致率与未纳入条数', async () => {
      openWithCalibration({
        runId: 'run-cal-1',
        datasetId: 'ds-1',
        metricFamily: 'verdict3',
        status: 'ok',
        threshold: 20,
        n: 22,
        excluded: 2,
        agreements: 17,
        agreementRate: 77.3,
        disagreements: [],
        note: '一致率只用于评估判官口径，不进入任何指标或发布证据。',
      });

      const card = await screen.findByTestId('run-calibration');
      expect(within(card).getByText(/一致率 77.3%/)).toBeTruthy();
      expect(within(card).getByText(/未纳入比对 2 条/)).toBeTruthy();
    });
  });

  describe('幽灵值与量纲', () => {
    const baseRun = {
      id: 'base-run-1',
      datasetId: 'ds-1',
      status: 'COMPLETED',
      mode: 'LIVE',
      scope: 'full',
      baselineRunId: null,
      createdBy: 'admin',
      summary: { total: 1, processed: 1, judged: 1 },
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:10:00.000Z',
      results: [],
    };

    function openRun(run: unknown) {
      const enterEval = wireEvalTab(evalDatasetDetail, run);
      render(<AiQualityPage />);
      enterEval();
      openTab('回归测试');
      fireEvent.change(screen.getByLabelText('选择评测集'), {
        target: { value: 'ds-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: /base-run/ }));
    }

    it('不展示没有产出路径的 QUEUED 状态文案', async () => {
      openRun({ ...baseRun, status: 'QUEUED' });

      await waitFor(() => expect(mockGetRun).toHaveBeenCalled());
      // 评测运行只会是 RUNNING/COMPLETED/FAILED/CANCELLED；
      // 「排队中」是永不会出现的幽灵状态，不得出现在页面上。
      expect(screen.queryByText(/排队中/)).toBeNull();
    });

    it('运行卡消费执行失败类别并给出中文说明', async () => {
      openRun({ ...baseRun, executionErrorKind: 'live_call' });

      await waitFor(() => expect(mockGetRun).toHaveBeenCalled());
      expect(
        screen.getByText(/执行错误：实时调用失败（live_call）/),
      ).toBeTruthy();
    });
  });

  describe('角色默认视图', () => {
    const selectDataset = () =>
      fireEvent.change(screen.getByLabelText('选择评测集'), {
        target: { value: 'ds-1' },
      });

    it('运营、研发默认落在质量待办，可直接进入队列', () => {
      for (const role of ['EDITOR', 'ADMIN', 'VIEWER']) {
        mockRole.current = role;
        wireFeedback();
        const view = render(<AiQualityPage />);
        expect(screen.getByRole('button', { name: '开始质检' })).toBeTruthy();
        expect(screen.queryByLabelText('选择评测集')).toBeNull();
        view.unmount();
      }
    });

    it('管理者默认落在回归测试，先看运行与证据', () => {
      mockRole.current = 'SUPER_ADMIN';
      const enterEval = wireEvalTab(evalDatasetDetail);
      enterEval();
      render(<AiQualityPage />);

      expect(screen.getByLabelText('选择评测集')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '开始质检' })).toBeNull();
    });

    it('从不同视图进入同一 run，数字口径一致', () => {
      // 运营从队列切到回归测试。
      mockRole.current = 'ADMIN';
      const enterFromQueue = wireEvalTab(evalDatasetDetail);
      const first = render(<AiQualityPage />);
      enterFromQueue();
      openTab('回归测试');
      selectDataset();
      const viaQueue = screen.getByText('最近一次通过率').parentElement
        ?.textContent;
      first.unmount();
      expect(viaQueue).toContain('50.0%');

      // 管理者直接落在回归测试。
      mockRole.current = 'SUPER_ADMIN';
      const enterDirect = wireEvalTab(evalDatasetDetail);
      enterDirect();
      render(<AiQualityPage />);
      selectDataset();

      expect(
        screen.getByText('最近一次通过率').parentElement?.textContent,
      ).toBe(viaQueue);
    });
  });

  describe('写入口双重控制', () => {
    it('VIEWER 不渲染创建评测集、导入用例与启动运行', () => {
      mockRole.current = 'VIEWER';
      const enterEval = wireEvalTab(evalDatasetDetail);
      render(<AiQualityPage />);
      enterEval();
      openTab('回归测试');

      expect(screen.queryByRole('button', { name: '创建评测集' })).toBeNull();
      expect(screen.queryByRole('button', { name: '启动批量评测' })).toBeNull();
      // 高级模式是导入用例的唯一入口，只读角色看不到。
      expect(screen.queryByRole('button', { name: '高级模式' })).toBeNull();
      expect(screen.queryByText('只读角色仅可查看结果')).toBeTruthy();
    });

    it('AI_EVAL_ENABLED 关闭时不渲染写入口，并说明原因', () => {
      const enterEval = wireEvalTab(evalDatasetDetail, null, datasets, kbRegressionStatus, null, null, {
        feedbackUiEnabled: true,
        evalEnabled: false,
      });
      render(<AiQualityPage />);
      enterEval();
      openTab('回归测试');

      expect(screen.getByText(/AI 评测未启用（AI_EVAL_ENABLED=false）/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '创建评测集' })).toBeNull();
      expect(screen.queryByRole('button', { name: '启动批量评测' })).toBeNull();
      expect(screen.queryByRole('button', { name: '高级模式' })).toBeNull();
    });
  });
});
