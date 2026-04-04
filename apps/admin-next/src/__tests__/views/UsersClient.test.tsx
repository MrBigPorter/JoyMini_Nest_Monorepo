import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { repoUiMock } from '../mocks/view-helpers';

const userListClientPropsSpy = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());

vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@/components/users/UserListClient', () => ({
  UserListClient: (props: Record<string, unknown>) => {
    userListClientPropsSpy(props);
    return <div data-testid="user-list-client" />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () =>
    new URLSearchParams(
      'userId=u-1&status=1&page=2&pageSize=20&startTime=2026-03-01',
    ),
}));

import { UsersClient } from '@/components/users/UsersClient';

describe('UsersClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<UsersClient />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders UserListClient', () => {
    render(<UsersClient />);
    expect(screen.getByTestId('user-list-client')).toBeInTheDocument();
  });

  it('passes URL params to UserListClient', () => {
    render(<UsersClient />);

    expect(userListClientPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFormParams: {
          userId: 'u-1',
          status: '1',
          page: '2',
          pageSize: '20',
          startTime: '2026-03-01',
        },
        onParamsChange: expect.any(Function),
      }),
    );
  });
});
