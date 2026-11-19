import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
} from '../../mocks/view-helpers';

const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseMutation = vi.hoisted(() => vi.fn());
const mockUseQueryClient = vi.hoisted(() => vi.fn());
const mockRevalidateUsersList = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());

vi.mock('@repo/ui', () => ({
  ...repoUiMock,
  Badge: ({ children }: React.PropsWithChildren<{ variant?: string }>) => (
    <span>{children}</span>
  ),
}));
vi.mock('@/components/scaffold/BaseTable', () => ({
  BaseTable: BaseTableMock,
}));
vi.mock('@/components/scaffold/SchemaSearchForm', () => ({
  SchemaSearchForm: SchemaSearchFormMock,
}));
vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));
vi.mock('@/components/UIComponents', () => ({
  Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('next/image', () => ({
  default: () => <div data-testid="next-image" />,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: (...args: unknown[]) => mockUseQueryClient(...args),
}));
vi.mock('@/lib/actions/users-revalidate', () => ({
  revalidateUsersList: (...args: unknown[]) => mockRevalidateUsersList(...args),
}));
vi.mock('@lucky/shared', () => ({
  DEFAULT_LOCALE: 'zh',
  AVAILABLE_LOCALES: ['zh', 'en', 'ja', 'ko', 'fr', 'de'],
  KYC_STATUS: {
    DRAFT: 0,
    REVIEWING: 1,
    APPROVED: 4,
    REJECTED: 3,
  },
}));
vi.mock('@/api', () => ({
  clientUserApi: {
    getUsers: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    updateUser: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: mockAddToast }),
}));
vi.mock('@/views/user-management/UserDetailModal', () => ({
  UserDetailModal: () => <div data-testid="user-detail-modal" />,
}));

import { UserListClient } from '@/components/users/UserListClient';

describe('UserListClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: { data: [], total: 0 },
      isFetching: false,
      refetch: vi.fn(),
    });
    mockUseMutation.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseQueryClient.mockReturnValue({
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
    });
  });

  it('renders without crashing', () => {
    expect(render(<UserListClient />).container.firstChild).not.toBeNull();
  });

  it('renders the user table', () => {
    render(<UserListClient />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders search form', () => {
    render(<UserListClient />);
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('renders page header', () => {
    render(<UserListClient />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockUseQuery.mockReturnValue({
      data: { data: [], total: 0 },
      isFetching: true,
      refetch: vi.fn(),
    });

    expect(render(<UserListClient />).container.firstChild).not.toBeNull();
  });

  it('initializes filters from initialFormParams', () => {
    render(
      <UserListClient
        initialFormParams={{
          userId: 'u-1',
          phone: '123456',
          status: '0',
          kycStatus: '4',
          page: '2',
          pageSize: '20',
          startTime: '2026-03-01T00:00:00.000Z',
          endTime: '2026-03-02T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('accepts onParamsChange callback', () => {
    const onParamsChange = vi.fn();
    render(<UserListClient onParamsChange={onParamsChange} />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('封禁写操作：onMutate 立即改缓存，onError 回滚到快照', async () => {
    const previous = { data: [{ id: 'u-1', status: 1 }], total: 1 };
    const setQueryData = vi.fn();
    mockUseQueryClient.mockReturnValue({
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn().mockReturnValue(previous),
      setQueryData,
    });
    let config: any;
    mockUseMutation.mockImplementation((c) => {
      config = c;
      return { mutateAsync: vi.fn() };
    });

    render(<UserListClient />);
    const context = await config.onMutate({
      id: 'u-1',
      status: 0,
      successMessage: 'ok',
    });

    // 先改：界面立即看到 status=0
    expect(setQueryData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: [expect.objectContaining({ id: 'u-1', status: 0 })],
      }),
    );

    // 后校：失败回滚到最后一次快照
    config.onError(new Error('boom'), { id: 'u-1', status: 0 }, context);
    expect(setQueryData).toHaveBeenLastCalledWith(context.queryKey, previous);
    // 并给出可理解的提示
    expect(mockAddToast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('写成功调用 revalidateUsersList 失效服务端缓存', async () => {
    let config: any;
    mockUseMutation.mockImplementation((c) => {
      config = c;
      return { mutateAsync: vi.fn() };
    });

    render(<UserListClient />);
    await config.onSuccess(null, { successMessage: 'ok' });

    expect(mockRevalidateUsersList).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith('success', 'ok');
  });
});
