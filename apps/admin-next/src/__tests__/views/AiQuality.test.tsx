import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetFeedbackList = vi.hoisted(() => vi.fn());
const mockUpdateFeedback = vi.hoisted(() => vi.fn());
const mockListDatasets = vi.hoisted(() => vi.fn());
const mockGetDataset = vi.hoisted(() => vi.fn());
const mockRagSearch = vi.hoisted(() => vi.fn());
const mockQualityStats = vi.hoisted(() => vi.fn());
const mockCanTriage = vi.hoisted(() => vi.fn(() => true));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  chatApi: {
    getFeedbackList: (...args: unknown[]) => mockGetFeedbackList(...args),
  },
  aiQualityApi: {
    updateFeedback: (...args: unknown[]) => mockUpdateFeedback(...args),
    listDatasets: (...args: unknown[]) => mockListDatasets(...args),
    getDataset: (...args: unknown[]) => mockGetDataset(...args),
    createDataset: vi.fn(),
    addCases: vi.fn(),
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
  createdAt: '2026-01-01T00:00:00.000Z',
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

function openTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('AiQualityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanTriage.mockReturnValue(true);
    mockUpdateFeedback.mockResolvedValue({});
    mockGetFeedbackList.mockResolvedValue({ list: [feedback], total: 1 });
    mockListDatasets.mockResolvedValue(datasets);
    mockRagSearch.mockResolvedValue({ results: [], debug: {} });
    mockQualityStats.mockResolvedValue(stats);
    mockUseRequest.mockReturnValue(
      makeUseRequest({ list: [feedback], total: 1 }),
    );
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

  it('translates feedback source, signal and review status', () => {
    render(<AiQualityPage />);

    expect(screen.getByText('隐式信号')).toBeTruthy();
    expect(screen.getByText('转人工')).toBeTruthy();
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0);
    expect(screen.getByText('确认问题')).toBeTruthy();
    expect(screen.getByText('排除')).toBeTruthy();

    const link = screen.getByRole('link', { name: '查看上下文' });
    expect(link.getAttribute('href')).toBe(
      '/ai-ops/context?conversationId=conv-1',
    );
  });

  it('sends REVIEWED with the operator note', async () => {
    const refresh = vi.fn();
    mockUseRequest.mockReturnValue({
      ...makeUseRequest({ list: [feedback], total: 1 }),
      refresh,
    });
    render(<AiQualityPage />);

    fireEvent.click(screen.getByRole('button', { name: '确认问题' }));

    await waitFor(() =>
      expect(mockUpdateFeedback).toHaveBeenCalledWith('fb-1', {
        reviewStatus: 'REVIEWED',
        note: '已确认是模型答非所问',
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('hides triage actions but keeps status and context for read-only roles', () => {
    mockCanTriage.mockReturnValue(false);
    render(<AiQualityPage />);

    expect(screen.queryByRole('button', { name: '确认问题' })).toBeNull();
    expect(screen.queryByRole('button', { name: '排除' })).toBeNull();
    expect(screen.getByText('只读')).toBeTruthy();
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '查看上下文' })).toBeTruthy();
  });

  it('shows an error banner instead of the empty state when the request fails', () => {
    mockUseRequest.mockReturnValue({
      ...makeUseRequest({ list: [], total: 0 }),
      error: new Error('feedback down'),
    });
    render(<AiQualityPage />);

    expect(screen.getByText('反馈列表加载失败，请重试')).toBeTruthy();
    expect(screen.queryByText('暂无反馈')).toBeNull();
  });

  it('shows the empty state only when the request has no error', () => {
    mockUseRequest.mockReturnValue(makeUseRequest({ list: [], total: 0 }));
    render(<AiQualityPage />);

    expect(screen.getByText('暂无反馈')).toBeTruthy();
  });

  it('keeps the JSON import behind a collapsed advanced-mode toggle', () => {
    mockUseRequest
      .mockReturnValueOnce(makeUseRequest({ list: [], total: 0 }))
      .mockReturnValue(makeUseRequest(datasets));
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
