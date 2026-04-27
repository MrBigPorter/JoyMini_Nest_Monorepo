import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  repoUiBadgeMock,
  SmartTableMock,
} from '../mocks/view-helpers';

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@repo/ui/components/ui/badge', () => repoUiBadgeMock);
vi.mock('@/components/scaffold/SmartTable', () => ({
  SmartTable: SmartTableMock,
}));
vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: ({ title }: { title: React.ReactNode }) => (
    <div data-testid="page-header">{title}</div>
  ),
}));

const mockAddToast = vi.fn();
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof mockAddToast }) => unknown) =>
    sel({ addToast: mockAddToast }),
}));
vi.mock('@/api', () => ({
  clientUserApi: {
    getUsers: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    updateUser: vi.fn().mockResolvedValue({}),
    getUserById: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('@lucky/shared', () => ({
  DEFAULT_LOCALE: 'zh',
  AVAILABLE_LOCALES: ['zh', 'en', 'ja', 'ko', 'fr', 'de'],
  KYC_STATUS: { DRAFT: 0, REVIEWING: 1, APPROVED: 2, REJECTED: 3 },
}));
vi.mock('@/views/user-management/UserDetailModal', () => ({
  UserDetailModal: () => <div data-testid="user-detail-modal" />,
}));

// ── subject ──────────────────────────────────────────────────────
import { UserManagement } from '@/views/UserManagement';

describe('UserManagement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders without crashing', () => {
    const { container } = render(<UserManagement />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders SmartTable', () => {
    render(<UserManagement />);
    expect(screen.getByTestId('smart-table')).toBeInTheDocument();
  });

  it('renders "Client Database" title inside SmartTable header', () => {
    render(<UserManagement />);
    expect(screen.getByText(/client database/i)).toBeInTheDocument();
  });
});
