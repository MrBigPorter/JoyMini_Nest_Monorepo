import { ORDER_STATUS } from '@lucky/shared';

export const ORDER_STATUS_COLORS = {
  [ORDER_STATUS.PENDING_PAYMENT]: 'yellow', // 1 待支付
  [ORDER_STATUS.PROCESSING_PAYMENT]: 'blue', // 2 支付中
  [ORDER_STATUS.PAID]: 'green', // 3 已支付
  [ORDER_STATUS.CANCELED]: 'gray', // 4 已取消
  [ORDER_STATUS.REFUNDED]: 'red', // 5 已退款
  [ORDER_STATUS.WAIT_GROUP]: 'purple', // 6 待成团
  [ORDER_STATUS.WAIT_DELIVERY]: 'blue', // 7 待发货 (Ready to Ship)
  [ORDER_STATUS.SHIPPED]: 'green', // 8 已发货
  [ORDER_STATUS.COMPLETED]: 'green', // 9 已完成
} as const;
