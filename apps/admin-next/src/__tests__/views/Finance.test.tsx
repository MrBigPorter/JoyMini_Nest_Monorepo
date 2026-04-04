import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/views/finance/TransactionList', () => ({
  TransactionList: () => <div data-testid="transaction-list">Transactions</div>,
}));
vi.mock('@/views/finance/WithdrawalList', () => ({
  WithdrawalList: () => <div data-testid="withdrawal-list">Withdrawals</div>,
}));
vi.mock('@/views/finance/DepositList', () => ({
  DepositList: () => <div data-testid="deposit-list">Deposits</div>,
}));

import { FinancePage } from '@/components/finance/FinancePageClient';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('Finance (FinancePage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(
      renderWithQueryClient(<FinancePage />).container.firstChild,
    ).not.toBeNull();
  });

  it('shows Transactions tab by default', () => {
    renderWithQueryClient(<FinancePage />);
    expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
  });

  it('renders tab navigation buttons', () => {
    renderWithQueryClient(<FinancePage />);
    expect(
      screen.getByRole('button', { name: /transactions flow/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /deposit records/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /withdrawal audits/i }),
    ).toBeInTheDocument();
  });

  it('switches to Deposits tab when clicked', () => {
    renderWithQueryClient(<FinancePage />);
    fireEvent.click(screen.getByRole('button', { name: /deposit records/i }));
    expect(screen.getByTestId('deposit-list')).toBeInTheDocument();
  });

  it('switches to Withdrawals tab when clicked', () => {
    renderWithQueryClient(<FinancePage />);
    fireEvent.click(screen.getByRole('button', { name: /withdrawal audits/i }));
    expect(screen.getByTestId('withdrawal-list')).toBeInTheDocument();
  });

  it('does not re-sync tab when only onParamsChange callback identity changes', async () => {
    const queryClient = new QueryClient();
    const onParamsChange1 = vi.fn();
    const firstRender = render(
      <QueryClientProvider client={queryClient}>
        <FinancePage onParamsChange={onParamsChange1} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(onParamsChange1).toHaveBeenCalledWith({ tab: 'transactions' });
    });

    const onParamsChange2 = vi.fn();
    firstRender.rerender(
      <QueryClientProvider client={queryClient}>
        <FinancePage onParamsChange={onParamsChange2} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(onParamsChange2).not.toHaveBeenCalled();
    });
  });
});
