import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockReplace = vi.hoisted(() => vi.fn());
const mockGetList = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams('userId=u-1&loginStatus=1'),
}));
vi.mock('@/api', () => ({
  loginLogApi: {
    getList: mockGetList,
  },
}));

import { LoginLogList } from '@/components/login-logs/LoginLogsClient';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('LoginLogList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetList.mockResolvedValue({ list: [], total: 0 });
  });

  it('renders without crashing', () => {
    expect(
      renderWithQueryClient(<LoginLogList />).container.firstChild,
    ).not.toBeNull();
  });

  it('loads data with URL-derived initial params', async () => {
    renderWithQueryClient(<LoginLogList />);

    await waitFor(() => {
      expect(mockGetList).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          userId: 'u-1',
          loginStatus: 1,
        }),
      );
    });
  });

  it('syncs URL when search is applied', async () => {
    renderWithQueryClient(<LoginLogList />);
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
  });
});
