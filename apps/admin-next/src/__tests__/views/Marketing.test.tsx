import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  repoUiMock,
  makeUseAntdTable,
  makeUseRequest,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
} from '../mocks/view-helpers';

const mockUseAntdTable = vi.hoisted(() => vi.fn());
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
vi.mock('ahooks', () => ({
  useAntdTable: (...args: unknown[]) => mockUseAntdTable(...args),
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('@/api', () => ({
  couponApi: {
    getList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@lucky/shared', () => ({
  DEFAULT_LOCALE: 'zh',
  AVAILABLE_LOCALES: ['zh', 'en', 'ja', 'ko', 'fr', 'de'],
  COUPON_STATUS: { ACTIVE: 1, DISABLED: 0 },
  COUPON_TYPE: { FULL_REDUCTION: 1, DISCOUNT: 2, NO_THRESHOLD: 3 },
  COUPON_TYPE_OPTIONS: [{ label: 'Fixed', value: 1 }],
  DISCOUNT_TYPE: { FIXED: 1, PERCENT: 2 },
  ISSUE_TYPE: { MANUAL: 1, AUTO: 2 },
  VALID_TYPE: { DATE_RANGE: 1, RELATIVE: 2 },
  CalcHelper: { formatPercent: (v: number) => `${v}%` },
  NumHelper: { formatMoney: (v: number) => `₱${v}` },
  TimeHelper: { formatDate: (v: number) => String(v) },
}));
vi.mock('@/views/Marketing/CouponModal', () => ({
  CouponModal: () => <div data-testid="coupon-modal" />,
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));

// ── subject ──────────────────────────────────────────────────────
import { CouponList } from '@/views/Marketing/Coupon';

describe('Marketing — CouponList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAntdTable.mockReturnValue(makeUseAntdTable([], 0));
    mockUseRequest.mockReturnValue(makeUseRequest(undefined));
  });

  it('renders without crashing', () => {
    expect(render(<CouponList />).container.firstChild).not.toBeNull();
  });

  it('renders the coupon table', () => {
    render(<CouponList />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders search form', () => {
    render(<CouponList />);
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockUseAntdTable.mockReturnValue(makeUseAntdTable([], 0, true));
    expect(render(<CouponList />).container.firstChild).not.toBeNull();
  });
});
