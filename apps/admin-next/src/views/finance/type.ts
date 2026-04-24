import {
  WITHDRAW_STATUS,
  WithdrawStatus,
  RECHARGE_STATUS,
} from '@lucky/shared';
import type { ButtonVariant } from '@repo/ui';

export type TLabelFn = (key: string) => string;

export function getStatusConfig(t: TLabelFn) {
  return {
    [WITHDRAW_STATUS.PENDING_AUDIT as WithdrawStatus]: {
      color: 'yellow',
      label: t('finance.status.pendingAudit'),
    },
    [WITHDRAW_STATUS.SUCCESS as WithdrawStatus]: {
      color: 'green',
      label: t('finance.status.success'),
    },
    [WITHDRAW_STATUS.REJECTED as WithdrawStatus]: {
      color: 'red',
      label: t('finance.status.rejected'),
    },
    [WITHDRAW_STATUS.PROCESSING as WithdrawStatus]: {
      color: 'blue',
      label: t('finance.status.processing'),
    },
  } as const;
}

// 状态映射配置 (UI表现层)
export function getDepositStatusConfig(t: TLabelFn): Record<
  number,
  {
    color: 'green' | 'red' | 'yellow' | 'gray' | 'blue';
    label: string;
    buttonColor: ButtonVariant;
  }
> {
  return {
    [RECHARGE_STATUS.PENDING]: {
      color: 'yellow',
      label: t('finance.status.pending'),
      buttonColor: 'warning',
    },
    [RECHARGE_STATUS.PROCESSING]: {
      color: 'blue',
      label: t('finance.status.processing'),
      buttonColor: 'info',
    },
    [RECHARGE_STATUS.SUCCESS]: {
      color: 'green',
      label: t('finance.status.success'),
      buttonColor: 'success',
    },
    [RECHARGE_STATUS.FAILED]: {
      color: 'red',
      label: t('finance.status.failed'),
      buttonColor: 'danger',
    },
    [RECHARGE_STATUS.CANCELED]: {
      color: 'gray',
      label: t('finance.status.cancelled'),
      buttonColor: 'danger',
    },
  };
}

// 渠道筛选 Options
export function getChannelOptions(t: TLabelFn) {
  return [
    { label: t('finance.channels.gcash'), value: 'PH_GCASH' },
    { label: t('finance.channels.paymaya'), value: 'PH_PAYMAYA' },
    { label: t('finance.channels.grabpay'), value: 'PH_GRABPAY' },
    { label: t('finance.channels.bankTransfer'), value: 'PH_BDO' },
  ];
}
