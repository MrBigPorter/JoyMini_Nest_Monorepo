/**
 * Agent 执行步骤的记录
 * 每次 agent 循环结束后，记录本次执行的统计信息
 * 用于前端展示「思考链」和调试
 */
import { BaseMessage } from '@langchain/core/messages';

export interface AgentStep {
  /** 节点名称，如 'orderAgent'、'walletAgent' */
  node: string;
  /** 本轮总共调用了几次 tool */
  totalToolCalls: number;
  /** 循环迭代次数 */
  iterations: number;
  /** 最后一次调用的 tool 信息（如果有） */
  lastToolCall: {
    name: string;
    args: Record<string, any>;
  } | null;
  /** agent 内部总消息数 */
  totalMessages: number;
}

/**
 * Agent Node 统一返回类型
 *
 * 所有 agent node（order、wallet 等）都必须返回此形状，
 * 确保下游 answerSynthesizer 能统一消费。
 *
 * 使用 `satisfies AgentNodeOutput` 而不是类型注解，
 *    因为 LangGraph 期望 `Partial<typeof AgentState.State>`，
 *    satisfies 能在不改变 TypeScript 推断的前提下提供编译检查。
 */
export interface AgentNodeOutput {
  /** Agent 生成的纯文本回答 → 传给 answerSynthesizer */
  agentOutput: string;
  /** 保留原始的输入消息（而非 agent 内部消息） */
  messages: BaseMessage[];
  /** Agent 执行步骤日志 */
  agentSteps: AgentStep[];
}
