import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockReplace = vi.hoisted(() => vi.fn());
const mockGetList = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: ({ title }: { title?: React.ReactNode }) => (
    <div data-testid="page-header">{title}</div>
  ),
}));

vi.mock('@/api', () => ({
  loginLogApi: {
    getList: mockGetList,
  },
}));

import { LoginLogList } from '@/components/login-logs/LoginLogsClient';

const createLoginLog = (overrides?: Record<string, unknown>) => ({
  id: 'log-1',
  userId: 'user_1234567890',
  userNickname: 'Alice',
  userAvatar: null,
  loginTime: Date.UTC(2026, 2, 17, 6, 30, 0),
  loginType: 1,
  loginMethod: 'password',
  loginIp: '127.0.0.1',
  loginDevice: 'Chrome on macOS',
  countryCode: 'PH',
  city: 'Cebu',
  loginStatus: 1,
  failReason: null,
  tokenIssued: 1,
  ...overrides,
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('LoginLogList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetList.mockResolvedValue({ list: [], total: 0 });
  });

  it('renders empty state when login logs are empty', async () => {
    renderWithQueryClient(<LoginLogList />);

    expect(screen.getByTestId('page-header')).toHaveTextContent('Login Logs');

    await waitFor(() => {
      expect(screen.getByText('No login logs found')).toBeInTheDocument();
    });
  });

  it('renders login log rows with key fields', async () => {
    mockGetList.mockResolvedValue({ list: [createLoginLog()], total: 1 });

    renderWithQueryClient(<LoginLogList />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const row = screen.getByText('Alice').closest('tr');
    expect(row).not.toBeNull();

    expect(
      within(row as HTMLTableRowElement).getByText('127.0.0.1'),
    ).toBeInTheDocument();
    expect(
      within(row as HTMLTableRowElement).getByText('Success'),
    ).toBeInTheDocument();
    expect(
      within(row as HTMLTableRowElement).getByText('Chrome on macOS'),
    ).toBeInTheDocument();
  });

  it('applies filters and sends updated query params', async () => {
    renderWithQueryClient(<LoginLogList />);

    await waitFor(() => {
      expect(mockGetList).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });

    fireEvent.change(screen.getByPlaceholderText('User ID…'), {
      target: { value: 'user_1001' },
    });
    fireEvent.change(screen.getByPlaceholderText('IP…'), {
      target: { value: '192.168.0.1' },
    });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(mockGetList).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        userId: 'user_1001',
        loginIp: '192.168.0.1',
        loginStatus: 1,
      });
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('userId=user_1001'),
        { scroll: false },
      );
    });
  });

  it('triggers refresh action from toolbar', async () => {
    mockGetList.mockResolvedValue({ list: [createLoginLog()], total: 1 });

    renderWithQueryClient(<LoginLogList />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(mockGetList).toHaveBeenCalledTimes(2);
    });
  });
});
