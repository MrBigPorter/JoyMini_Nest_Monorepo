import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockCanRead = vi.hoisted(() => vi.fn(() => true));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: { getEvalReports: vi.fn() },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => 'ADMIN',
  canReadEvalReports: () => mockCanRead(),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiReportsPage from '@/app/(dashboard)/ai-ops/reports/page';

const report = {
  file: 'conv-1.json',
  runId: 'conv-1',
  datasetVersion: '2026-11-22.1',
  generatedAt: '2026-11-21T10:00:00.000Z',
  mode: 'advisory',
  gatePassed: false,
  conversationCount: 30,
  drillCount: 2,
  aggregates: {
    language_match: { pass: 29, fail: 1, unknown: 0, rate: 0.967 },
  },
  gates: [
    {
      key: 'language_match',
      label: '语言一致',
      ok: false,
      detail: 'pass=29, fail=1, unknown=0, rate=96.7%',
    },
  ],
  fairness: [],
};

describe('AiReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanRead.mockReturnValue(true);
  });

  it('展示门禁 FAIL、指标与历史报告', () => {
    mockUseRequest.mockReturnValue(makeUseRequest([report]));
    render(<AiReportsPage />);

    expect(screen.getByText('评测报告')).toBeInTheDocument();
    expect(screen.getByText(/门禁 FAIL/)).toBeInTheDocument();
    expect(screen.getAllByText('语言一致').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/96.7%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('conv-1').length).toBeGreaterThan(0);
  });

  it('旧报告没有 gates 时给出提示', () => {
    mockUseRequest.mockReturnValue(makeUseRequest([{ ...report, gates: [] }]));
    render(<AiReportsPage />);
    expect(
      screen.getByText('该报告未包含门禁数据（旧格式）。'),
    ).toBeInTheDocument();
  });

  it('无权限时显示提示', () => {
    mockCanRead.mockReturnValue(false);
    mockUseRequest.mockReturnValue(makeUseRequest([report]));
    render(<AiReportsPage />);
    expect(screen.getByText(/无权查看评测报告/)).toBeInTheDocument();
  });
});
