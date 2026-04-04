import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { makeUseRequest, repoUiMock } from '../mocks/view-helpers';

// ── hoisted mock variables ────────────────────────────────────────
const mockUseRequest = vi.hoisted(() => vi.fn());

// ── mocks ────────────────────────────────────────────────────────
vi.mock('@repo/ui', () => repoUiMock);
vi.mock('ahooks', () => ({
  useRequest: (...args: unknown[]) => mockUseRequest(...args),
}));
vi.mock('@/api', () => ({
  categoryApi: {
    getCategories: vi.fn().mockResolvedValue([]),
    createCategory: vi.fn().mockResolvedValue({ id: '99', name: 'New' }),
    updateCategory: vi.fn().mockResolvedValue({}),
    deleteCategory: vi.fn().mockResolvedValue({}),
    toggleCategoryStatus: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('@/views/category/EditCategoryModal', () => ({
  EditCategoryModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="edit-modal">
      <button onClick={onClose}>Close Edit</button>
    </div>
  ),
}));
vi.mock('@/views/category/CreateCategoryModal', () => ({
  CreateCategoryModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-modal">
      <button onClick={onClose}>Close Create</button>
    </div>
  ),
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

  it('opens create modal when Add button is clicked', () => {
    render(<CategoryManagement />);
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByTestId('create-modal')).toBeInTheDocument();
  });

  it('opens edit modal when edit button is clicked', () => {
    render(<CategoryManagement />);
    const editBtns = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editBtns[0]);
    expect(screen.getByTestId('edit-modal')).toBeInTheDocument();
  });
});
