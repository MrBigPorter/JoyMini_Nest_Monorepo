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
  SmartImageMock,
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
vi.mock('@/components/ui/SmartImage', () => ({ SmartImage: SmartImageMock }));
vi.mock('ahooks', () => ({
  useAntdTable: (...args: unknown[]) => mockUseAntdTable(...args),
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('@/api', () => ({
  actSectionApi: {
    getList: vi.fn().mockResolvedValue({ list: [], total: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    bindProduct: vi.fn().mockResolvedValue({}),
    unbindProduct: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@lucky/shared', () => ({
  getActSectionTypeLabel: (v: number) => `Type${v}`,
}));
vi.mock('@/views/act-section/ActSectionBindProductModal', () => {
  const ActSectionBindProductModal = () => (
    <div data-testid="bind-product-modal" />
  );
  ActSectionBindProductModal.displayName = 'ActSectionBindProductModal';
  return { ActSectionBindProductModal };
});

vi.mock('@/views/act-section/ProductSelectorModal', () => {
  const ProductSelectorModal = () => (
    <div data-testid="product-selector-modal" />
  );
  ProductSelectorModal.displayName = 'ProductSelectorModal';
  return { ProductSelectorModal };
});

vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));

// ── subject ──────────────────────────────────────────────────────
import { ActSectionManagement } from '@/components/act/ActSectionManagementClient';

describe('ActSectionManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAntdTable.mockReturnValue(makeUseAntdTable([], 0));
    mockUseRequest.mockReturnValue(makeUseRequest(undefined));
  });

  it('renders without crashing', () => {
    expect(
      render(<ActSectionManagement />).container.firstChild,
    ).not.toBeNull();
  });

  it('renders the act section table', () => {
    render(<ActSectionManagement />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders search form', () => {
    render(<ActSectionManagement />);
    expect(screen.getByTestId('search-form')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockUseAntdTable.mockReturnValue(makeUseAntdTable([], 0, true));
    expect(
      render(<ActSectionManagement />).container.firstChild,
    ).not.toBeNull();
  });
});
