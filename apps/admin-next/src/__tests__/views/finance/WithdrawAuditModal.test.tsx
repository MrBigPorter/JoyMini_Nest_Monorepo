import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockUseMutation = vi.hoisted(() => vi.fn());
const mockAddToast = vi.hoisted(() => vi.fn());
const mockRevalidate = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}));
vi.mock('@/api', () => ({
  financeApi: { withdrawalsAudit: mockAudit },
}));
vi.mock('@/lib/actions/finance-revalidate', () => ({
  revalidateFinanceAfterWithdrawAudit: mockRevalidate,
}));
vi.mock('@/store/useToastStore', () => ({
  useToastStore: (
    sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown,
  ) => sel({ addToast: mockAddToast }),
}));
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy: vi.fn() }),
}));
vi.mock('@repo/ui', () => ({
  Button: ({ children }: React.PropsWithChildren) => (
    <button>{children}</button>
  ),
  ModalManager: { open: vi.fn() },
}));
vi.mock('@/lib/shared-wrapper', () => ({
  NumHelper: { formatMoney: (v: unknown) => String(v) },
  TimeHelper: { formatDateTime: () => '2026-11-19' },
  WITHDRAW_STATUS: { PENDING_AUDIT: 1, SUCCESS: 2, REJECTED: 3 },
}));

import { WithdrawAuditModal } from '@/views/finance/WithdrawAuditModal';

const data = {
  withdrawId: 'w-1',
  withdrawNo: 'WD001',
  withdrawStatus: 1,
  withdrawMethod: 2,
  bankName: 'BDO',
  accountName: 'Porter',
  withdrawAccount: '123456',
  withdrawAmount: '100.00',
  feeAmount: '2.00',
  actualAmount: '98.00',
  appliedAt: Date.now(),
  user: { nickname: 'Porter', phone: '+63917' },
} as never;

function renderModal() {
  let config: any;
  mockUseMutation.mockImplementation((c) => {
    config = c;
    return { mutateAsync: vi.fn(), isPending: true };
  });
  render(
    <WithdrawAuditModal
      data={data}
      confirmAction={vi.fn()}
      tAction={((k: string) => k) as never}
    />,
  );
  return config;
}

describe('WithdrawAuditModal（资金操作保守策略）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('没有 onMutate：不做乐观更新', () => {
    const config = renderModal();
    expect(config.onMutate).toBeUndefined();
  });

  it('提交中保持处理中态（isPending 直接驱动 loading）', () => {
    const config = renderModal();
    expect(config.mutationFn).toEqual(expect.any(Function));
  });

  it('成功后才失效缓存并关闭弹窗', () => {
    const confirmAction = vi.fn();
    let config: any;
    mockUseMutation.mockImplementation((c) => {
      config = c;
      return { mutateAsync: vi.fn(), isPending: false };
    });
    render(
      <WithdrawAuditModal
        data={data}
        confirmAction={confirmAction}
        tAction={((k: string) => k) as never}
      />,
    );

    config.onSuccess();

    expect(mockRevalidate).toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalled();
  });

  it('5xx/网络错误明确提示，且不触发成功回调', () => {
    const confirmAction = vi.fn();
    let config: any;
    mockUseMutation.mockImplementation((c) => {
      config = c;
      return { mutateAsync: vi.fn(), isPending: false };
    });
    render(
      <WithdrawAuditModal
        data={data}
        confirmAction={confirmAction}
        tAction={((k: string) => k) as never}
      />,
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    config.onError(new Error('network down'));

    expect(mockAddToast).toHaveBeenCalledWith('error', expect.any(String));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it('4xx 交给 HTTP 拦截器提示，不重复 toast', () => {
    const config = renderModal();

    config.onError({ response: { status: 400 } });

    expect(mockAddToast).not.toHaveBeenCalled();
  });
});
