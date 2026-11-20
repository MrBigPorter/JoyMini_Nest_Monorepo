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

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetFeedbackList = vi.hoisted(() => vi.fn());
const mockGetFeedbackSummary = vi.hoisted(() => vi.fn());
const mockUpdateFeedback = vi.hoisted(() => vi.fn());
const mockListDatasets = vi.hoisted(() => vi.fn());
const mockAddCases = vi.hoisted(() => vi.fn());
const mockRagSearch = vi.hoisted(() => vi.fn());
const mockQualityStats = vi.hoisted(() => vi.fn());
const mockCanTriage = vi.hoisted(() => vi.fn(() => true));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
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
    startRun: vi.fn(),
    getRun: vi.fn(),
    ragSearch: (...args: unknown[]) => mockRagSearch(...args),
  },
  knowledgeApi: {
    qualityStats: (...args: unknown[]) => mockQualityStats(...args),
  },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => 'ADMIN',
  canTriageFeedback: () => mockCanTriage(),
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

function wireFeedback(
  options: {
    summaryData?: unknown;
    listData?: unknown;
    datasetsData?: unknown;
    summaryError?: Error;
    listError?: Error;
    refresh?: () => void;
  } = {},
) {
  const refresh = options.refresh ?? vi.fn();
  let index = 0;
  mockUseRequest.mockImplementation((service: unknown) => {
    if (typeof service === 'function') void (service as () => unknown)();
    // FeedbackPanel registers three hooks in order: summary, list, datasets.
    const slot = index % 3;
    index += 1;
    if (slot === 0) {
      return {
        ...makeUseRequest(options.summaryData ?? summary),
        ...(options.summaryError ? { error: options.summaryError } : {}),
        refresh,
      };
    }
    if (slot === 1) {
      return {
        ...makeUseRequest(
          options.listData ?? { list: [feedback], total: 1 },
        ),
        ...(options.listError ? { error: options.listError } : {}),
        refresh,
      };
    }
    return {
      ...makeUseRequest(options.datasetsData ?? datasets),
      refresh,
    };
  });
  return refresh;
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('AiQualityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanTriage.mockReturnValue(true);
    mockUpdateFeedback.mockResolvedValue({});
    mockGetFeedbackList.mockResolvedValue({ list: [feedback], total: 1 });
    mockGetFeedbackSummary.mockResolvedValue(summary);
    mockListDatasets.mockResolvedValue(datasets);
    mockAddCases.mockResolvedValue({ id: 'ds-1', cases: [] });
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

  it('sends resolution and the selected failure kind on triage', async () => {
    const refresh = wireFeedback();
    render(<AiQualityPage />);

    fireEvent.change(screen.getByLabelText('主要原因'), {
      target: { value: 'MODEL_ERROR' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认问题' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        reviewStatus: 'REVIEWED',
        resolution: 'CONFIRMED',
        failureKind: 'MODEL_ERROR',
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
        failureKind: 'UNKNOWN',
        note: '已确认是模型答非所问',
      }),
    );
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
            expect: {},
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

  it('routes to the eval tab when no regression dataset exists', () => {
    wireFeedback({ datasetsData: [] });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '加入回归' }));
    expect(screen.getByText('先创建评测集')).toBeTruthy();

    mockUseRequest.mockReturnValue(makeUseRequest([]));
    fireEvent.click(screen.getByRole('button', { name: '去创建评测集' }));

    expect(screen.getByRole('button', { name: '创建评测集' })).toBeTruthy();
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

  it('passes failureKind and resolution filters to the list query', async () => {
    render(<AiQualityPage />);

    fireEvent.change(screen.getByLabelText('归因筛选'), {
      target: { value: 'MODEL_ERROR' },
    });
    fireEvent.change(screen.getByLabelText('处理状态筛选'), {
      target: { value: 'CONFIRMED' },
    });

    await waitFor(() =>
      expect(mockGetFeedbackList).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        failureKind: 'MODEL_ERROR',
        resolution: 'CONFIRMED',
      }),
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
