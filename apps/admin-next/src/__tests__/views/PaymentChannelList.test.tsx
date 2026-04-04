import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
  SmartImageMock,
} from '../mocks/view-helpers';

const mockUseQuery = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
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
vi.mock('@/components/ui/SmartImage', () => ({ SmartImage: SmartImageMock }));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));
vi.mock('@/api', () => ({
  paymentChannelApi: {
    getList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/views/payment-channel/PaymentChannelModal', () => {
  const PaymentChannelModal = () => <div data-testid="payment-channel-modal" />;
  PaymentChannelModal.displayName = 'PaymentChannelModal';
  return { PaymentChannelModal };
});

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

  it('renders BaseTable', () => {
    render(<PaymentChannelList />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders page header', () => {
    render(<PaymentChannelList />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });
});
