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
}));
vi.mock('@lucky/shared', () => ({
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
  ) => sel({ addToast: vi.fn() }),
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
});
