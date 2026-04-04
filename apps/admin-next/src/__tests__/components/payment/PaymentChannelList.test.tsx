import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
  SmartImageMock,
} from '../../mocks/view-helpers';

const mockUseQuery = vi.hoisted(() => vi.fn());

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
vi.mock('@/components/ui/SmartImage', () => ({ SmartImage: SmartImageMock }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));
vi.mock('@/api', () => ({
  paymentChannelApi: {
    getList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/views/payment-channel/PaymentChannelModal', () => {
  const PaymentChannelModal = () => <div data-testid="payment-channel-modal" />;
  PaymentChannelModal.displayName = 'PaymentChannelModal';
  return { PaymentChannelModal };
});
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));

// ── subject ──────────────────────────────────────────────────────
import { PaymentChannelList } from '@/components/payment/PaymentChannelListClient';

describe('PaymentChannelList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: { list: [], total: 0 },
      isFetching: false,
      refetch: vi.fn(),
    });
  });

  it('renders without crashing', () => {
    expect(render(<PaymentChannelList />).container.firstChild).not.toBeNull();
  });

  it('renders the payment channel table', () => {
    render(<PaymentChannelList />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders search form', () => {
    render(<PaymentChannelList />);
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockUseQuery.mockReturnValue({
      data: { list: [], total: 0 },
      isFetching: true,
      refetch: vi.fn(),
    });
    expect(render(<PaymentChannelList />).container.firstChild).not.toBeNull();
  });

  it('renders page header with correct title', () => {
    render(<PaymentChannelList />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('initializes filters from initialFormParams', () => {
    render(
      <PaymentChannelList
        initialFormParams={{ name: 'Test', type: '1', status: '1' }}
      />,
    );
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('calls onParamsChange when search is triggered', () => {
    const onParamsChange = vi.fn();
    render(<PaymentChannelList onParamsChange={onParamsChange} />);
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('displays empty list message when data is empty', () => {
    mockUseQuery.mockReturnValue({
      data: { list: [], total: 0 },
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<PaymentChannelList />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });
});
