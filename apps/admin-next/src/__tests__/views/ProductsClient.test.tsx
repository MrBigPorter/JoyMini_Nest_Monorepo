import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { repoUiMock } from '../mocks/view-helpers';

const productListPropsSpy = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());

vi.mock('@repo/ui', () => repoUiMock);
vi.mock('@/components/products/ProductListClient', () => ({
  ProductListClient: (props: Record<string, unknown>) => {
    productListPropsSpy(props);
    return <div data-testid="product-list-client" />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () =>
    new URLSearchParams(
      'treasureName=Ring&categoryId=3&filterType=ACTIVE&page=2&pageSize=20',
    ),
}));

import { ProductsClient } from '@/components/products/ProductsClient';

describe('ProductsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<ProductsClient />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders ProductListClient', () => {
    render(<ProductsClient />);
    expect(screen.getByTestId('product-list-client')).toBeInTheDocument();
  });

  it('passes URL params to ProductListClient', () => {
    render(<ProductsClient />);

    expect(productListPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFormParams: {
          treasureName: 'Ring',
          categoryId: '3',
          filterType: 'ACTIVE',
          page: '2',
          pageSize: '20',
        },
        onParamsChange: expect.any(Function),
      }),
    );
  });
});
