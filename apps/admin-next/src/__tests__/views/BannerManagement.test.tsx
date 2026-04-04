import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  repoUiMock,
  makeUseRequest,
  BaseTableMock,
  SchemaSearchFormMock,
  PageHeaderMock,
  SmartImageMock,
} from '../mocks/view-helpers';

// ── hoisted mock variables ────────────────────────────────────────
const mockUseRequest = vi.hoisted(() => vi.fn());
const mockGetList = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
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
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('@/api', () => ({
  bannerApi: {
    getList: mockGetList,
    delete: vi.fn().mockResolvedValue({}),
    updateState: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@lucky/shared', () => ({ JUMP_CATE: { PRODUCT: 1, URL: 2 } }));
vi.mock('@/views/banner/BannerFormModal', () => ({
  BannerFormModal: () => <div data-testid="banner-form-modal" />,
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: vi.fn() }),
}));

const BANNERS_MOCK = [
  {
    id: '1',
    title: 'Summer Sale',
    bannerCate: 1,
    state: 1,
    sort: 1,
    imageUrl: '/img.jpg',
  },
  {
    id: '2',
    title: 'Winter Promo',
    bannerCate: 2,
    state: 0,
    sort: 2,
    imageUrl: '/img2.jpg',
  },
];

// ── subject ──────────────────────────────────────────────────────
import { BannerManagement } from '@/components/banners/BannerManagementClient';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('BannerManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRequest.mockReturnValue(makeUseRequest(undefined));
    mockGetList.mockResolvedValue({ list: BANNERS_MOCK, total: 2 });
  });

  it('renders without crashing', () => {
    const { container } = renderWithQueryClient(<BannerManagement />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders the BaseTable', () => {
    renderWithQueryClient(<BannerManagement />);
    expect(screen.getByTestId('base-table')).toBeInTheDocument();
  });

  it('renders page header', () => {
    renderWithQueryClient(<BannerManagement />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('shows loading state gracefully', () => {
    mockGetList.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>,
    );
    const { container } = renderWithQueryClient(<BannerManagement />);
    expect(container.firstChild).not.toBeNull();
  });

  it('requests banners with normalized initial params', async () => {
    renderWithQueryClient(
      <BannerManagement
        initialFormParams={{ title: 'Sale', bannerCate: '1' }}
      />,
    );

    await waitFor(() => {
      expect(mockGetList).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 10,
          title: 'Sale',
          bannerCate: 1,
        }),
      );
    });
  });
});
