import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

const mockUseRequest = vi.hoisted(() => vi.fn());

vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));

vi.mock('@repo/ui', () => ({
  ModalManager: {
    open: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: ({ title }: { title?: React.ReactNode }) => (
    <div data-testid="page-header">{title}</div>
  ),
}));

vi.mock('@/api', () => ({
  adsApi: {
    getList: vi.fn(),
    toggleStatus: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));

import { adsApi } from '@/api';
import { ModalManager } from '@repo/ui';
import { AdsManagement } from '@/components/ads/AdsManagementClient';

const createAd = (overrides?: Record<string, unknown>) => ({
  id: 'ad1',
  createdAt: Date.now(),
  title: 'Ad Alpha',
  fileType: 1,
  img: 'https://cdn.example.com/ad.png',
  videoUrl: '',
  adPosition: 1,
  sortOrder: 1,
  jumpUrl: 'https://example.com',
  startTime: null,
  endTime: null,
  status: 1,
  viewCount: 20,
  clickCount: 5,
  ...overrides,
});

const mockAdsRequest = ({
  list,
  total = list.length,
  loading = false,
}: {
  list: ReturnType<typeof createAd>[];
  total?: number;
  loading?: boolean;
}) => {
  const refresh = vi.fn();
  mockUseRequest.mockReturnValue({
    data: { list, total },
    loading,
    run: refresh,
  });

  return refresh;
};

describe('AdsManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when ad list is empty', () => {
    mockAdsRequest({ list: [] });

    render(<AdsManagement />);

    expect(screen.getByTestId('page-header')).toHaveTextContent(
      'Advertisements',
    );
    expect(screen.getByText('No ads found')).toBeInTheDocument();
  });

  it('renders ad rows with key fields', () => {
    mockAdsRequest({ list: [createAd()] });

    render(<AdsManagement />);

    expect(screen.getByText('Ad Alpha')).toBeInTheDocument();
    const row = screen.getByText('Ad Alpha').closest('tr');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLTableRowElement).getByText('Home Top'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /enabled/i }),
    ).toBeInTheDocument();
  });

  it('toggles status and refreshes list', async () => {
    const refresh = mockAdsRequest({ list: [createAd()] });

    render(<AdsManagement />);

    fireEvent.click(screen.getByRole('button', { name: /enabled/i }));

    await waitFor(() => {
      expect(adsApi.toggleStatus).toHaveBeenCalledWith('ad1');
      expect(refresh).toHaveBeenCalled();
    });
  });

  it('does not delete ad when confirmation is cancelled', async () => {
    const refresh = mockAdsRequest({ list: [createAd()] });
    // ModalManager.open is mocked as vi.fn() — onConfirm is never called (modal dismissed)
    vi.mocked(ModalManager.open).mockImplementation(() => ({
      close: vi.fn(),
    }));

    render(<AdsManagement />);

    const row = screen.getByText('Ad Alpha').closest('tr');
    expect(row).not.toBeNull();
    const rowButtons = within(row as HTMLTableRowElement).getAllByRole(
      'button',
    );

    fireEvent.click(rowButtons[2]);

    await waitFor(() => {
      expect(adsApi.remove).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  it('deletes ad after confirmation and refreshes list', async () => {
    const refresh = mockAdsRequest({ list: [createAd()] });
    // Simulate user clicking "Confirm" in the modal
    vi.mocked(ModalManager.open).mockImplementation((props) => {
      props.onConfirm?.();
      return {
        close: vi.fn(),
      };
    });

    render(<AdsManagement />);

    const row = screen.getByText('Ad Alpha').closest('tr');
    expect(row).not.toBeNull();
    const rowButtons = within(row as HTMLTableRowElement).getAllByRole(
      'button',
    );

    fireEvent.click(rowButtons[2]);

    await waitFor(() => {
      expect(adsApi.remove).toHaveBeenCalledWith('ad1');
      expect(refresh).toHaveBeenCalled();
    });
  });
});
