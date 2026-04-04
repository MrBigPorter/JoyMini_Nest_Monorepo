import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const operationLogListPropsSpy = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());

vi.mock('@/components/operation-logs/OperationLogListClient', () => ({
  OperationLogList: (props: Record<string, unknown>) => {
    operationLogListPropsSpy(props);
    return <div data-testid="operation-log-list-client" />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () =>
    new URLSearchParams(
      'adminId=a1&action=LOGIN&keyword=edit&page=2&pageSize=20&startDate=2026-03-01&endDate=2026-03-20',
    ),
}));

import { OperationLogClient } from '@/components/operation-logs/OperationLogClient';

describe('OperationLogClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<OperationLogClient />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders OperationLogList', () => {
    render(<OperationLogClient />);
    expect(screen.getByTestId('operation-log-list-client')).toBeInTheDocument();
  });

  it('passes URL params to OperationLogList', () => {
    render(<OperationLogClient />);

    expect(operationLogListPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFormParams: {
          adminId: 'a1',
          action: 'LOGIN',
          keyword: 'edit',
          page: '2',
          pageSize: '20',
          startDate: '2026-03-01',
          endDate: '2026-03-20',
        },
        onParamsChange: expect.any(Function),
      }),
    );
  });
});
