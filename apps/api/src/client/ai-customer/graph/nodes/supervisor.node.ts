/**
 * Supervisor Node — 方案 B（纯轮次计数器）
 *
 * 方案 B 变更说明：
 * - 方案 A：IntentRouter 只分类（single-domain），Supervisor 做 LLM 分解 → 5 种幻觉根因
 * - 方案 B：IntentRouter 同时处理分类 + 多领域检测（JSON 输出），Supervisor 只做轮次计数
 *
 * 当前职责：
 * - 收到 `intent='supervised'` 和 `tasks[]` 后，递增 supervisorRound 计数器
 * - supervisorRouter 根据 round 索引 dispatch 对应 task 的 agent
 * - 所有 task 执行完毕后，supervisorRouter 返回 answerSynthesizer
 */
import { Logger } from '@nestjs/common';
import { AgentState } from '@api/client/ai-customer/graph/state';

const logger = new Logger('SupervisorNode');

export const createSupervisorNode =
  () =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const currentRound = state.supervisorRound ?? 0;
    logger.log(`[supervisorNode] round ${currentRound} → ${currentRound + 1}`);
    return { supervisorRound: currentRound + 1 };
  };
