import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { repoUiMock, repoUiBadgeMock } from '../mocks/view-helpers';

const smartTablePropsSpy = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@repo/ui/components/ui/badge', () => repoUiBadgeMock);
vi.mock('@/components/scaffold/SmartTable', () => ({
  SmartTable: Object.assign(
    React.forwardRef(function SmartTableMock(
      props: { headerTitle?: React.ReactNode },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _ref: React.ForwardedRef<unknown>,
    ) {
      smartTablePropsSpy(props);
      return <div data-testid="smart-table">{props.headerTitle}</div>;
    }),
    { displayName: 'SmartTableMock' },
  ),
}));

const mockAddToast = vi.fn();
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof mockAddToast }) => unknown) =>
    sel({ addToast: mockAddToast }),
}));

vi.mock('@/api', () => ({
  addressApi: {
    list: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    deleteAddress: vi.fn().mockResolvedValue({}),
    updateAddress: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('@/views/address/AddressEditModal', () => ({
  AddressEditModal: () => <div data-testid="address-edit-modal" />,
}));

// ── subject ──────────────────────────────────────────────────────
import { AddressList } from '@/components/address/AddressListClient';

describe('AddressList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders without crashing', () => {
    const { container } = render(<AddressList />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders SmartTable', () => {
    render(<AddressList />);
    expect(screen.getByTestId('smart-table')).toBeInTheDocument();
  });

  it('accepts initialFormParams and enables hydration', () => {
    const onParamsChange = vi.fn();
    render(
      <AddressList
        initialFormParams={{ userId: 'u-1', province: 'Cebu' }}
        onParamsChange={onParamsChange}
      />,
    );

    expect(smartTablePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFormParams: {
          page: 1,
          pageSize: 10,
          userId: 'u-1',
          province: 'Cebu',
        },
        onParamsChange,
        enableHydration: true,
        hydrationQueryKey: ['address', 1, 10, '', 'u-1', 'Cebu', ''],
      }),
    );
  });
});
