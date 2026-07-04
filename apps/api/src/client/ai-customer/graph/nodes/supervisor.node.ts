/**
 * Supervisor Node — 多 Agent 协作的车间主任
 *
 * ── 方案 B（纯轮次计数器）的设计考量 ──
 *
 * 方案 A（已弃用）：IntentRouter 只分类（single-domain），Supervisor 用 LLM 分解任务
 * → 5 种幻觉根因（LLM 分解任务时容易凭空捏造不存在的任务）
 *
 * 方案 B（当前）：IntentRouter 同时处理分类 + 多领域检测（JSON 输出），
 * Supervisor 只做轮次计数。让 IntentRouter（更简单的 LLM 调用）做分解，
 * 避免 Supervisor 的 LLM 产生幻觉。
 *
 * ── 当前职责 ──
 * - 收到 `intent='supervised'` 和 `tasks[]` 后，递增 supervisorRound 计数器
 * - supervisorRouter 根据 round 索引 dispatch 对应 task 的 agent
 * - 所有 task 执行完毕后，supervisorRouter 返回 answerSynthesizer
 *
 * ── 生活类比 ──
 * 车间主任手里有一张派工单。他的工作就是喊"A 组去！"、"B 组去！"、"C 组去！"。
 * 至于"A 组要做什么"，已经在派工单（pendingTasks）上写好了。
 * 主任不需要知道 A 组具体干什么，他只负责"叫下一个"。
 */
import { Logger } from '@nestjs/common';
import { AgentState } from '@api/client/ai-customer/graph/state';

const logger = new Logger('SupervisorNode');

export const createSupervisorNode =
  () =>
  async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    // ⚠️ This node is no longer used in the new architecture.
    // Orchestrator handles all agent dispatching internally.
    // Kept for reference only.
    return {};
  };
