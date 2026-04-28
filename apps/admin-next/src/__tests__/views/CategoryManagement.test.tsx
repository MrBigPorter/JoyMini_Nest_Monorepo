import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeUseRequest, repoUiMock } from '../mocks/view-helpers';

// ── hoisted mock variables ────────────────────────────────────────
const mockUseRequest = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('lucide-react', () => ({
  Trash2: () => <span>Delete</span>,
}));
vi.mock('@/api', () => ({
  categoryApi: {
    getCategories: vi.fn().mockResolvedValue([]),
    deleteCategory: vi.fn().mockResolvedValue({}),
  },
}));

const CATEGORIES_MOCK = [
  { id: '1', name: 'Electronics', status: 1, productCount: 10 },
  { id: '2', name: 'Clothing', status: 0, productCount: 5 },
];

// ── subject ──────────────────────────────────────────────────────
import { CategoryManagement } from '@/components/categories/CategoriesClient';

describe('CategoryManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRequest.mockReturnValue(makeUseRequest(CATEGORIES_MOCK));
  });

  it('renders without crashing', () => {
    const { container } = render(<CategoryManagement />);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows categories from API', () => {
    render(<CategoryManagement />);
    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.getByText('Clothing')).toBeInTheDocument();
  });

  it('shows loading state (no category names visible)', () => {
    mockUseRequest.mockReturnValue(makeUseRequest(undefined, true));
    render(<CategoryManagement />);
    expect(screen.queryByText('Electronics')).not.toBeInTheDocument();
  });
});
