import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { framerMotionMock } from '../mocks/view-helpers';

// ── hoisted mock variables ────────────────────────────────────────
const mockRouterPush = vi.hoisted(() => vi.fn());
const mockLogin = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockAuthLogin = vi.hoisted(() => vi.fn());
const mockAuthClearCookie = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('framer-motion', () => framerMotionMock);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: (sel: (s: { login: typeof mockLogin }) => unknown) =>
    sel({ login: mockLogin }),
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof mockAddToast }) => unknown) =>
    sel({ addToast: mockAddToast }),
}));
vi.mock('@/api', () => ({
  authApi: { login: mockAuthLogin, clearCookie: mockAuthClearCookie },
}));

// ── shared test fixtures ──────────────────────────────────────────
const MOCK_USER_INFO = {
  id: 'admin-1',
  username: 'admin',
  realName: 'Test Admin',
  role: 'SUPER_ADMIN',
  status: 1,
  roleId: '',
  roleName: 'Super Admin',
  lastLoginAt: 0,
};

// ── subject ──────────────────────────────────────────────────────
import { Login } from '@/views/Login';

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders username and password inputs', () => {
    render(<Login />);
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('renders Sign In button', () => {
    render(<Login />);
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it('renders "Apply for access" link pointing to /register-apply', () => {
    render(<Login />);
    const link = screen.getByRole('link', { name: /apply for access/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/register-apply');
  });

  it('shows validation errors when submitting empty form', async () => {
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText(/username is required/i)).toBeInTheDocument(),
    );
  });

  it('shows password length error for short password', async () => {
    const user = userEvent.setup();
    render(<Login />);
    await user.type(screen.getByPlaceholderText('Username'), 'admin');
    await user.type(screen.getByPlaceholderText('Password'), '123');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument(),
    );
  });

  it('calls authApi.login with correct credentials on valid submit', async () => {
    mockAuthLogin.mockResolvedValue({
      tokens: { accessToken: 'test-token' },
      userInfo: MOCK_USER_INFO,
    });
    const user = userEvent.setup();
    render(<Login />);
    await user.type(screen.getByPlaceholderText('Username'), 'admin');
    await user.type(screen.getByPlaceholderText('Password'), 'password123');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(mockAuthLogin).toHaveBeenCalledWith({
        username: 'admin',
        password: 'password123',
      }),
    );
  });

  it('stores token and redirects to / on success', async () => {
    mockAuthLogin.mockResolvedValue({
      tokens: { accessToken: 'jwt-abc' },
      userInfo: MOCK_USER_INFO,
    });
    const user = userEvent.setup();
    render(<Login />);
    await user.type(screen.getByPlaceholderText('Username'), 'admin');
    await user.type(screen.getByPlaceholderText('Password'), 'secret99');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith(
        'jwt-abc',
        'SUPER_ADMIN',
        expect.objectContaining({ id: 'admin-1', role: 'SUPER_ADMIN' }),
        null,
      );
      expect(mockAddToast).toHaveBeenCalledWith(
        'success',
        expect.stringContaining('Welcome'),
      );
      expect(mockRouterPush).toHaveBeenCalledWith('/');
    });
  });

  it('shows error toast on login failure (no access token)', async () => {
    mockAuthLogin.mockResolvedValue({
      tokens: { accessToken: '' },
      userInfo: MOCK_USER_INFO,
    });
    const user = userEvent.setup();
    render(<Login />);
    await user.type(screen.getByPlaceholderText('Username'), 'admin');
    await user.type(screen.getByPlaceholderText('Password'), 'badpass1');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(mockAddToast).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('No access token'),
      ),
    );
  });

  it('renders with local token should auto-clear stale tokens', async () => {
    localStorage.setItem('auth_token', 'stale-auth');
    localStorage.setItem('refresh_token', 'stale-refresh');
    sessionStorage.setItem('csrf_token', 'stale-csrf');
    mockAuthClearCookie.mockResolvedValue({ ok: true });

    render(<Login />);

    await waitFor(() => {
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(sessionStorage.getItem('csrf_token')).toBeNull();
      expect(mockAuthClearCookie).toHaveBeenCalled();
    });
  });
});
