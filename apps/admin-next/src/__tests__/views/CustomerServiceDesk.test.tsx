import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { makeUseRequest, PageHeaderMock } from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetConversations = vi.hoisted(() => vi.fn());

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

vi.mock('@repo/ui', () => ({
  ModalManager: {
    open: vi.fn(),
    close: vi.fn(),
  },
}));

import { CustomerServiceDesk } from '@/components/customer-service/CustomerServiceClient';

describe('CustomerServiceDesk', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetConversations.mockResolvedValue({
      list: [],
      total: 0,
      page: 1,
      pageSize: 30,
    });

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
});
