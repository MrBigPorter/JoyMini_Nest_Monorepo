import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetQueues = vi.hoisted(() => vi.fn());
const mockGetAiFailed = vi.hoisted(() => vi.fn());
const mockGetOutbox = vi.hoisted(() => vi.fn());
const mockPauseQueue = vi.hoisted(() => vi.fn());
const mockResumeQueue = vi.hoisted(() => vi.fn());
const mockCleanQueue = vi.hoisted(() => vi.fn());
const mockReplayAiJob = vi.hoisted(() => vi.fn());
const mockReplayOutbox = vi.hoisted(() => vi.fn());
const mockCanManageQueues = vi.hoisted(() => vi.fn(() => true));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiOpsApi: {
    getQueues: (...args: unknown[]) => mockGetQueues(...args),
    getAiFailed: (...args: unknown[]) => mockGetAiFailed(...args),
    getOutbox: (...args: unknown[]) => mockGetOutbox(...args),
    pauseQueue: (...args: unknown[]) => mockPauseQueue(...args),
    resumeQueue: (...args: unknown[]) => mockResumeQueue(...args),
    cleanQueue: (...args: unknown[]) => mockCleanQueue(...args),
    replayAiJob: (...args: unknown[]) => mockReplayAiJob(...args),
    replayOutbox: (...args: unknown[]) => mockReplayOutbox(...args),
  },
}));

vi.mock('@/lib/ai-ops-permissions', () => ({
  useAiOpsRole: () => 'ADMIN',
  canManageQueues: () => mockCanManageQueues(),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@repo/ui', () => repoUiMock);

import AiRuntimePage from '@/app/(dashboard)/ai-ops/runtime/page';

const queue = {
  name: 'ai-processing',
  waiting: 2,
  active: 1,
  completed: 10,
  failed: 1,
  delayed: 0,
  paused: 0,
  total: 14,
  isPaused: false,
};

function queueRequests() {
  mockUseRequest
    .mockReturnValueOnce(makeUseRequest([queue]))
    .mockReturnValueOnce(makeUseRequest([]))
    .mockReturnValueOnce(makeUseRequest([]));
}

describe('AiRuntimePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanManageQueues.mockReturnValue(true);
    mockGetQueues.mockResolvedValue([queue]);
    mockGetAiFailed.mockResolvedValue([]);
    mockGetOutbox.mockResolvedValue([]);
    mockPauseQueue.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows queue data and write actions for ADMIN', () => {
    queueRequests();
    render(<AiRuntimePage />);
    expect(screen.getByText('ai-processing')).toBeTruthy();
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清理已完成' })).toBeTruthy();
  });

  it('does not treat success:false as success', async () => {
    queueRequests();
    mockPauseQueue.mockResolvedValue({
      success: false,
      message: 'Failed to pause queue',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const refresh = vi.fn();
    mockUseRequest.mockReset();
    mockUseRequest
      .mockReturnValueOnce({ ...makeUseRequest([queue]), refresh })
      .mockReturnValueOnce(makeUseRequest([]))
      .mockReturnValueOnce(makeUseRequest([]));

    render(<AiRuntimePage />);
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Failed to pause queue'),
    );
    expect(refresh).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('hides write actions for read-only roles', () => {
    mockCanManageQueues.mockReturnValue(false);
    queueRequests();
    render(<AiRuntimePage />);
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull();
    expect(screen.getByText('只读')).toBeTruthy();
  });
});
