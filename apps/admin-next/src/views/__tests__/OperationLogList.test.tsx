import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  SmartTableMock,
  PageHeaderMock,
} from '../../__tests__/mocks/view-helpers';
import { OperationLogList } from '@/components/operation-logs/OperationLogListClient';

// ── hoisted mock variables ────────────────────────────────────────
const mockGetList = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@/components/scaffold/SmartTable', () => ({
  SmartTable: SmartTableMock,
}));
vi.mock('@/components/scaffold/PageHeader', () => ({
  PageHeader: PageHeaderMock,
}));
vi.mock('@/components/UIComponents', () => ({
  Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/api', () => ({
  adminOperationLogApi: { getList: mockGetList },
}));

// ── mock data (Prisma 对齐字段) ───────────────────────────────────
const MOCK_LOGS_RESPONSE = {
  list: [
    {
      id: '1',
      adminId: 'admin-1',
      adminName: 'testadmin',
      module: 'auth',
      action: 'LOGIN',
      details: 'Admin logged in',
      requestIp: '127.0.0.1',
      createdAt: '2026-03-16T10:00:00Z',
      admin: { id: 'admin-1', username: 'testadmin', realName: 'Test Admin' },
    },
    {
      id: '2',
      adminId: 'admin-1',
      adminName: 'testadmin',
      module: 'products',
      action: 'UPDATE',
      details: 'Updated product details',
      requestIp: '127.0.0.1',
      createdAt: '2026-03-16T11:00:00Z',
      admin: { id: 'admin-1', username: 'testadmin', realName: null },
    },
  ],
  total: 2,
  page: 1,
  pageSize: 10,
};

// ── tests ─────────────────────────────────────────────────────────
describe('OperationLogList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetList.mockResolvedValue(MOCK_LOGS_RESPONSE);
  });

  it('should render without crashing', () => {
    render(<OperationLogList />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('should render page title "Operation Logs"', () => {
    render(<OperationLogList />);
    expect(screen.getByText('Operation Logs')).toBeInTheDocument();
  });

  it('should render SmartTable', () => {
    render(<OperationLogList />);
    expect(screen.getByTestId('smart-table')).toBeInTheDocument();
  });

  it('should render header title "Audit Trail"', () => {
    render(<OperationLogList />);
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
  });

  it('should accept initialFormParams without crashing', () => {
    render(
      <OperationLogList
        initialFormParams={{ action: 'LOGIN', keyword: 'test' }}
        onParamsChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('should accept onParamsChange callback without crashing', () => {
    const onParamsChange = vi.fn();
    render(<OperationLogList onParamsChange={onParamsChange} />);
    expect(screen.getByTestId('smart-table')).toBeInTheDocument();
  });
});
