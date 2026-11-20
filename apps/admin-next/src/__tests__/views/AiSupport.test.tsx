import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  makeUseRequest,
  PageHeaderMock,
  repoUiMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockSlaHistory = vi.hoisted(() => vi.fn());
const mockSlaQueue = vi.hoisted(() => vi.fn());
const mockClaim = vi.hoisted(() => vi.fn());
const mockCloseConversation = vi.hoisted(() => vi.fn());
const mockRole = vi.hoisted(() => ({ current: 'ADMIN' }));

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  aiQualityApi: {
    slaHistory: (...args: unknown[]) => mockSlaHistory(...args),
    slaQueue: (...args: unknown[]) => mockSlaQueue(...args),
  },
  chatApi: {
    claim: (...args: unknown[]) => mockClaim(...args),
    closeConversation: (...args: unknown[]) => mockCloseConversation(...args),
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

import AiSupportPage from '@/app/(dashboard)/ai-ops/support/page';

const history = {
  windowHours: 24,
  thresholdMinutes: 5,
  latest: {
    id: 'snap-1',
    waiting: 1,
    breached: 1,
    longestWait: 320,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  snapshots: [
    {
      id: 'snap-1',
      waiting: 1,
      breached: 1,
      longestWait: 320,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const queue = {
  thresholdMinutes: 5,
  items: [
    {
      conversationId: 'conv-1',
      transferredAt: '2026-01-01T00:00:00.000Z',
      transferReason: '用户要求人工',
      lastMessage: '我的券怎么还没发',
      lastMessageAt: '2026-01-01T00:00:00.000Z',
      waitingSeconds: 320,
      breached: true,
    },
  ],
};

function queueRequests() {
  const historyRefresh = vi.fn().mockResolvedValue(undefined);
  const queueRefresh = vi.fn().mockResolvedValue(undefined);
  const historyRequest = {
    ...makeUseRequest(history),
    refresh: historyRefresh,
  };
  const queueRequest = { ...makeUseRequest(queue), refresh: queueRefresh };
  let call = 0;
  mockUseRequest.mockReset();
  // The page always calls useRequest twice per render: slaHistory then
  // slaQueue. State updates in action handlers re-render, so alternate on
  // every call instead of relying on one-shot mockReturnValueOnce.
  mockUseRequest.mockImplementation(() => {
    call += 1;
    return call % 2 === 1 ? historyRequest : queueRequest;
  });
  return { historyRefresh, queueRefresh };
}

describe('AiSupportPage', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let promptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRole.current = 'ADMIN';
    mockSlaHistory.mockResolvedValue(history);
    mockSlaQueue.mockResolvedValue(queue);
    mockClaim.mockResolvedValue({
      success: true,
      conversationId: 'conv-1',
      handlerId: 'handler-1',
    });
    mockCloseConversation.mockResolvedValue({
      success: true,
      conversationId: 'conv-1',
    });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('客户要求关闭');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('links the 打开 action to the exact conversation deep link', () => {
    queueRequests();
    render(<AiSupportPage />);

    const link = screen.getByRole('link', { name: '打开' });
    expect(link.getAttribute('href')).toBe(
      '/customer-service?conversationId=conv-1',
    );
  });

  it('shows claim and close actions for ADMIN', () => {
    queueRequests();
    render(<AiSupportPage />);
    expect(screen.getByRole('button', { name: '认领' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
    expect(screen.queryByText(/当前角色为只读/)).toBeNull();
  });

  it('shows claim and close actions for EDITOR', () => {
    mockRole.current = 'EDITOR';
    queueRequests();
    render(<AiSupportPage />);
    expect(screen.getByRole('button', { name: '认领' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });

  it('hides actions and shows a read-only note for VIEWER', () => {
    mockRole.current = 'VIEWER';
    queueRequests();
    render(<AiSupportPage />);
    expect(screen.queryByRole('button', { name: '认领' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
    expect(
      screen.getByText(/当前角色为只读，可以查看转人工队列/),
    ).toBeTruthy();
    expect(screen.getByText('只读')).toBeTruthy();
  });

  it('claims a conversation after confirmation and refreshes data', async () => {
    const { historyRefresh, queueRefresh } = queueRequests();
    render(<AiSupportPage />);

    fireEvent.click(screen.getByRole('button', { name: '认领' }));

    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('conv-1'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(
      '已认领会话 conv-1',
    );
    expect(historyRefresh).toHaveBeenCalled();
    expect(queueRefresh).toHaveBeenCalled();
  });

  it('closes a conversation with a required reason', async () => {
    const { historyRefresh, queueRefresh } = queueRequests();
    render(<AiSupportPage />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() =>
      expect(mockCloseConversation).toHaveBeenCalledWith('conv-1', {
        reason: '客户要求关闭',
      }),
    );
    expect(promptSpy).toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(
      '已关闭会话 conv-1',
    );
    expect(historyRefresh).toHaveBeenCalled();
    expect(queueRefresh).toHaveBeenCalled();
  });

  it('rejects a blank close reason without calling the API', async () => {
    queueRequests();
    promptSpy.mockReturnValue('   ');
    render(<AiSupportPage />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '关闭原因不能为空',
      ),
    );
    expect(mockCloseConversation).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
