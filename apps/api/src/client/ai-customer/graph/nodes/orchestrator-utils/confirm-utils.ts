/** 需要用户确认的写操作工具 */
export const CONFIRM_REQUIRED_TOOLS = new Set([
  'applyWithdraw',
  'claimCoupon',
  'redeemCouponCode',
  'draw',
  'deleteAddress',
]);

export const NEGATIVE_KEYWORDS = [
  '烦',
  '投诉',
  '差',
  '慢',
  '垃圾',
  '没用',
  'frustrated',
  'angry',
  'useless',
  'terrible',
  'waste',
  'complaint',
  ' escalate',
];

/** tool name → action 映射 */
export function mapToolToAction(toolName: string): string {
  const map: Record<string, string> = {
    applyWithdraw: 'withdraw',
    claimCoupon: 'claim_coupon',
    redeemCouponCode: 'redeem_code',
    draw: 'draw',
    deleteAddress: 'delete_address',
  };
  return map[toolName] ?? toolName;
}

/** 构建卡片展示摘要 */
export function buildConfirmSummary(tool: {
  name: string;
  args: Record<string, any>;
}) {
  const summary: Record<string, any> = { action: mapToolToAction(tool.name) };
  switch (tool.name) {
    case 'applyWithdraw':
      summary.amount = tool.args.amount;
      summary.channel = tool.args.channelId;
      break;
    case 'claimCoupon':
      summary.couponId = tool.args.couponId;
      break;
    case 'redeemCouponCode':
      summary.code = tool.args.code;
      break;
    case 'draw':
      summary.ticketId = tool.args.ticketId;
      break;
    case 'deleteAddress':
      summary.addressId = tool.args.addressId;
      break;
  }
  return summary;
}
