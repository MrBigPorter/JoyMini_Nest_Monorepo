export type TurnStatus =
  | 'SUCCESS'
  | 'TRANSFERRED'
  | 'CONFIRM'
  | 'CONFIRM_REJECTED';

/**
 * trace 状态不能只看 graph 有没有 pendingConfirm：
 * routeConfirm 可能因守卫（不存在的券/目录外动作/错误渠道）不发卡。
 * 只有卡片真的创建成功才记 CONFIRM。
 */
export function resolveTurnStatus(
  transferred: boolean,
  confirmCard: boolean,
  cardCreated: boolean,
): TurnStatus {
  if (transferred) return 'TRANSFERRED';
  if (!confirmCard) return 'SUCCESS';
  return cardCreated ? 'CONFIRM' : 'CONFIRM_REJECTED';
}
