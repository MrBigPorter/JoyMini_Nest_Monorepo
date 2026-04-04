import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  repoUiMock,
  makeUseRequest,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
} from '../mocks/view-helpers';

const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetUsers = vi.hoisted(() => vi.fn());

vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@/components/scaffold/BaseTable', () => ({
  BaseTable: BaseTableMock,
}));
vi.mock('@/components/scaffold/SchemaSearchForm', () => ({
  SchemaSearchForm: SchemaSearchFormMock,
}));
vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));
vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('@/api', () => ({
  userApi: {
    getUsers: mockGetUsers,
    createUser: vi.fn().mockResolvedValue({}),
    updateUser: vi.fn().mockResolvedValue({}),
    deleteUser: vi.fn().mockResolvedValue({}),
  },
  applicationApi: {
    pendingCount: vi.fn().mockResolvedValue({ count: 0 }),
  },
}));
vi.mock('@/views/admin/CreateAdminUserModal', () => ({
  CreateAdminUserModal: () => <div data-testid="create-admin-modal" />,
}));
vi.mock('@/views/admin/EditAdminUserModal', () => ({
  EditAdminUserModal: () => <div data-testid="edit-admin-modal" />,
}));
vi.mock('@/views/admin/EditAdminPassowordModal', () => ({
  EditAdminPasswordModal: () => <div data-testid="edit-password-modal" />,
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));

import { AdminUserManagement } from '@/components/admin-users/AdminUserManagementClient';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('AdminUserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRequest.mockReturnValue(makeUseRequest(undefined));
    mockGetUsers.mockResolvedValue({ list: [], total: 0 });
  });

  it('renders without crashing', () => {
    expect(
      renderWithQueryClient(<AdminUserManagement />).container.firstChild,
    ).not.toBeNull();
  });

  it('renders "Admin Users" page header', () => {
    renderWithQueryClient(<AdminUserManagement />);
    expect(screen.getByTestId('page-header')).toHaveTextContent(/admin users/i);
  });

  it('renders the admin users table', () => {
    renderWithQueryClient(<AdminUserManagement />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockGetUsers.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>,
    );
    expect(
      renderWithQueryClient(<AdminUserManagement />).container.firstChild,
    ).not.toBeNull();
  });

  it('requests admin users with normalized initial params', async () => {
    renderWithQueryClient(
      <AdminUserManagement
        initialFormParams={{ username: 'porter', status: '1' }}
      />,
    );

    await waitFor(() => {
      expect(mockGetUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 10,
          username: 'porter',
          status: 1,
        }),
      );
    });
  });
});
