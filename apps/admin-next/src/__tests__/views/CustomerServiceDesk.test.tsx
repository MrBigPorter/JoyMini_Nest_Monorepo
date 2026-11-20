import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  usePathname,
  useRouter,
  useSearchParams,
} from 'next/navigation';
import { makeUseRequest, PageHeaderMock } from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetConversations = vi.hoisted(() => vi.fn());
const mockRouterReplace = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/api', () => ({
  chatApi: {
    getConversations: (...args: unknown[]) => mockGetConversations(...args),
    getMessages: vi.fn().mockResolvedValue({ list: [], nextCursor: null }),
    reply: vi.fn().mockResolvedValue({}),
    getUploadToken: vi.fn().mockResolvedValue({}),
    forceRecall: vi.fn().mockResolvedValue({ success: true }),
    closeConversation: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/hooks/useChatSocket', () => ({
  useChatSocket: () => ({
    status: 'connected',
    joinRoom: vi.fn(),
    sendViaSocket: vi.fn(),
  }),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

// 只验证选中状态，不渲染真实的聊天窗口
vi.mock('@/components/customer-service/ChatWindow', () => ({
  ChatWindow: ({ conversation }: { conversation: { id: string } }) => (
    <div data-testid="chat-window">{conversation.id}</div>
  ),
}));

vi.mock('@repo/ui', () => ({
  ModalManager: {
    open: vi.fn(),
    close: vi.fn(),
  },
}));

import { CustomerServiceDesk } from '@/components/customer-service/CustomerServiceClient';

const conversation = {
  id: 'conv-deep-1',
  type: 'SUPPORT' as const,
  name: 'Alice',
  status: 1,
  handlerId: 'handler-1',
  lastMsgContent: '你好',
  lastMsgTime: 1,
  lastMsgSeqId: 5,
  memberCount: 1,
  members: [
    { userId: 'user-1', nickname: 'Alice', avatar: null, role: 'MEMBER' },
  ],
};

function emptyPage(params: { pageSize?: number }) {
  return {
    list: [],
    total: 0,
    page: 1,
    pageSize: params?.pageSize ?? 30,
  };
}

describe('CustomerServiceDesk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterReplace.mockReset();

    // 默认路由 mock（next/navigation 在 vitest 配置中被替换为测试桩）
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: mockRouterReplace,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(usePathname).mockReturnValue('/customer-service');
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );

    mockGetConversations.mockImplementation((params: { pageSize?: number }) =>
      Promise.resolve(emptyPage(params)),
    );

    mockUseRequest.mockImplementation((service: unknown) => {
      if (typeof service === 'function') {
        void service();
      }
      return makeUseRequest(
        {
          list: [],
          total: 0,
          page: 1,
          pageSize: 30,
        },
        false,
      );
    });
  });

  it('requests SUPPORT conversation type by default', async () => {
    render(<CustomerServiceDesk />);

    await waitFor(() => {
      expect(mockGetConversations).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUPPORT',
          page: 1,
          pageSize: 30,
        }),
        { trace: false },
      );
    });
  });

  it('selects a deep-linked conversation already present in the list', async () => {
    mockUseRequest.mockImplementation((service: unknown) => {
      if (typeof service === 'function') {
        void service();
      }
      return makeUseRequest(
        { list: [conversation], total: 1, page: 1, pageSize: 30 },
        false,
      );
    });

    render(<CustomerServiceDesk initialConversationId="conv-deep-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-window').textContent).toBe('conv-deep-1');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to a direct fetch when the deep link is outside the loaded page', async () => {
    mockGetConversations.mockImplementation(
      (params: { pageSize?: number }) =>
        Promise.resolve(
          params?.pageSize === 100
            ? { list: [conversation], total: 1, page: 1, pageSize: 100 }
            : emptyPage(params),
        ),
    );

    render(<CustomerServiceDesk initialConversationId="conv-deep-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-window').textContent).toBe('conv-deep-1');
    });
    expect(mockGetConversations).toHaveBeenCalledWith(
      { page: 1, pageSize: 100, type: 'SUPPORT' },
      { trace: false },
    );
  });

  it('shows a clear state when a deep-linked conversation cannot be found', async () => {
    render(<CustomerServiceDesk initialConversationId="conv-missing" />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        '会话 conv-missing 不在当前列表',
      );
    });
    expect(screen.queryByTestId('chat-window')).toBeNull();
  });

  it('clears an invalid conversation id from the URL while keeping other filters', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(
        'keyword=refund&status=1&page=2&conversationId=conv-missing',
      ) as unknown as ReturnType<typeof useSearchParams>,
    );

    render(<CustomerServiceDesk initialConversationId="conv-missing" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    expect(mockRouterReplace).toHaveBeenCalledWith(
      '/customer-service?keyword=refund&status=1&page=2',
    );
  });
});
