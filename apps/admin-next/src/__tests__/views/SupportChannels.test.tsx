import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeUseRequest, PageHeaderMock } from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockToggle = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));

vi.mock('@/store/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof mockAddToast }) => unknown) =>
    sel({ addToast: mockAddToast }),
}));

vi.mock('@/api', () => ({
  chatApi: {
    getUploadToken: vi.fn().mockResolvedValue({
      url: 'https://upload.example.com',
      key: 'uploads/a.png',
      cdnUrl: 'https://img.example.com/uploads/a.png',
    }),
  },
  supportChannelApi: {
    getList: vi.fn(),
    create: (...args: unknown[]) => mockCreate(...args),
    update: vi.fn(),
    toggle: (...args: unknown[]) => mockToggle(...args),
  },
}));

import { SupportChannels } from '@/components/support-channels/SupportChannelsClient';

describe('SupportChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRequest.mockReturnValue(
      makeUseRequest(
        {
          list: [
            {
              id: 'official_platform_support_v1',
              name: 'Lucky Support',
              description: 'General',
              botUserId: 'bot_1',
              isActive: true,
              createdAt: '',
              updatedAt: '',
              botUser: {
                id: 'bot_1',
                nickname: 'Lucky Support',
                avatar: null,
                isRobot: true,
              },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
        false,
      ),
    );
    mockCreate.mockResolvedValue({});
    mockToggle.mockResolvedValue({});
  });

  it('renders support channels list', () => {
    render(<SupportChannels />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
    expect(screen.getByText('Lucky Support')).toBeInTheDocument();
    expect(
      screen.getByText('official_platform_support_v1'),
    ).toBeInTheDocument();
  });

  it('creates support channel from built-in business id', async () => {
    render(<SupportChannels />);

    fireEvent.click(screen.getByRole('button', { name: '+ New Channel' }));

    fireEvent.change(screen.getByPlaceholderText('Display name (English)'), {
      target: { value: 'Tech Support' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Channel' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'official_platform_support_v1',
          name: 'Tech Support',
        }),
      );
    });
  });

  it('creates support channel with custom business id', async () => {
    render(<SupportChannels />);

    fireEvent.click(screen.getByRole('button', { name: '+ New Channel' }));

    fireEvent.change(screen.getByDisplayValue('Built-in Business ID'), {
      target: { value: 'custom' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Custom businessId (e.g. my_support_v1)'),
      { target: { value: 'my_support_v1' } },
    );
    fireEvent.change(screen.getByPlaceholderText('Display name (English)'), {
      target: { value: 'My Support' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Channel' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'my_support_v1',
          name: 'My Support',
        }),
      );
    });
  });

  it('toggles channel status', async () => {
    render(<SupportChannels />);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => {
      expect(mockToggle).toHaveBeenCalledWith(
        'official_platform_support_v1',
        false,
      );
    });
  });
});
