/**
 * 发布前事实闸门：检测「已完成」类声明。
 *
 * 模型的自由文本是最容易产生幻觉的出口：它可以在没有任何工具调用、
 * 没有任何 EXECUTED 动作的情况下说「提现申请已提交」。这里只负责识别，
 * 是否放行由 AiCustomerService 结合 ai_action_requests 判断。
 */

import { ACTION_CATALOG } from './graph/config/action-catalog';

export const CLAIM_NOT_EXECUTED_REPLY =
  '这次操作还没有真正完成。请按上方的确认卡片完成确认（提现还需要短信验证码）。';

const CLAIM_PATTERNS = [
  /(已|已经)(提交|领取|兑换|删除|修改|新增|完成)/,
  /has been (submitted|claimed|redeemed|completed|deleted|updated|created)/i,
];

/** 明确在描述计划/要求确认/尚未发生的句子，不当作完成声明。 */
const NON_CLAIM_HINTS = /请确认|请点击|需要|将会|如果|尚未|还没有|未完成/;

export function detectCompletionClaim(text: string): boolean {
  const value = text ?? '';
  if (!value.trim()) return false;

  // 目录里的成功话术是强信号：只有执行成功才会由服务端发出。
  for (const entry of ACTION_CATALOG) {
    if (
      entry.successMessage &&
      value.includes(entry.successMessage)
    ) {
      return true;
    }
  }

  if (NON_CLAIM_HINTS.test(value)) return false;
  return CLAIM_PATTERNS.some((pattern) => pattern.test(value));
}
