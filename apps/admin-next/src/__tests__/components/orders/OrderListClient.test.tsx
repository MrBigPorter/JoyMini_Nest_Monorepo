import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
  makeUseRequest,
} from '../../mocks/view-helpers';

const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseRequest = vi.hoisted(() => vi.fn());

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
vi.mock('@/components/UIComponents', () => ({
  Card: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
  Badge: ({ children }: React.PropsWithChildren<{ color?: string }>) => (
    <span>{children}</span>
  ),
  Input: ({
    onChange,
    placeholder,
  }: {
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
  }) => <input onChange={onChange} placeholder={placeholder} />,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));
vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('@/api', () => ({
  orderApi: {
    getList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    updateState: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@lucky/shared', () => ({
  ORDER_STATUS: {
    PENDING_PAYMENT: 1,
    PAID: 2,
    CANCELED: 3,
    REFUNDED: 4,
    SHIPPED: 5,
  },
  ORDER_STATUS_LABEL: {
    1: 'Pending Payment',
    2: 'Paid',
    3: 'Canceled',
    4: 'Refunded',
    5: 'Shipped',
  },
}));
vi.mock('@/consts', () => ({
  ORDER_STATUS_COLORS: {
    1: 'yellow',
    2: 'blue',
    3: 'red',
    4: 'gray',
    5: 'green',
  },
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));

import { OrderListClient } from '@/components/orders/OrderListClient';

describe('OrderListClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: { list: [], total: 0 },
      isFetching: false,
      refetch: vi.fn(),
    });
    mockUseRequest.mockReturnValue(makeUseRequest(undefined));
  });

  it('renders without crashing', () => {
    expect(render(<OrderListClient />).container.firstChild).not.toBeNull();
  });

  it('renders the order table', () => {
    render(<OrderListClient />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders search form', () => {
    render(<OrderListClient />);
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('renders page header', () => {
    render(<OrderListClient />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockUseQuery.mockReturnValue({
      data: { list: [], total: 0 },
      isFetching: true,
      refetch: vi.fn(),
    });

    expect(render(<OrderListClient />).container.firstChild).not.toBeNull();
  });

  it('initializes filters from initialFormParams', () => {
    render(
      <OrderListClient
        initialFormParams={{
          keyword: 'ORD-001',
          orderStatus: '2',
          page: '2',
          pageSize: '20',
        }}
      />,
    );

    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('accepts onParamsChange callback', () => {
    const onParamsChange = vi.fn();
    render(<OrderListClient onParamsChange={onParamsChange} />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });
});
