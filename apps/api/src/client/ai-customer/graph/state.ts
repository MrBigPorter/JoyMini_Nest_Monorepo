/**
 * AgentState — LangGraph 状态定义（6 个字段）
 *
 * ── 和旧架构的区别（14 字段 → 6 字段） ──
 * 旧架构: messages, intent, previousIntent, pendingTasks, taskResults,
 *         supervisorRound, agentSteps, sources, userId,
 *         flowType, flowStatus, flowData, currentAgent, messageTopics, debug
 * 新架构: messages, intent, previousIntent, userId, labels, debug
 *
 * ── 被删除的字段及其替代方案 ──
 * - pendingTasks:       Orchestrator 用 labels[] 直接决定执行顺序
 * - taskResults:        Orchestrator 内部管理 agent 输出
 * - supervisorRound:    不再是 supervisor 模式，无需轮次计数
 * - agentSteps:         不再写入 state，由 Orchestrator 内部处理
 * - sources:            由 Orchestrator 内部传递
 * - flowType/flowStatus/flowData/currentAgent: 不再需要在 state 层级跟踪
 *   wallet agent 通过 flowDataAccumulator 在运行期间内部管理
 * - messageTopics:      所有 Agent 共享完整上下文，无需按话题过滤
 */
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { LabelItem } from '@api/client/ai-customer/graph/types/agent-types';

export const AgentState = Annotation.Root({

  /**
   * messages — 对话消息列表
   *
   * 核心数据。messagesStateReducer 自动追加新消息。
   * 所有 Agent 共享完整的对话历史，每个 Agent 通过 Scope Restriction 自控。
   */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * intent — 主意图标签
   *
   * intentRouter 设置的最高分标签。用于快速路由判断和日志。
   * 如果 labels 为空（如 unknown），orchestrator 会 fallback 到 generalChat。
   */
  intent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * previousIntent — 上一轮主意图
   *
   * orchestrator 在每轮结束时把 state.intent 存到这里。
   * 下一轮 intentRouter 用 previousIntent 结合对话历史做多标签分类的上下文参考。
   */
  previousIntent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * labels — 多标签分类结果
   *
   * intentRouter 设置的多标签分类结果数组。
   * 每个元素: { label: string, score: number }
   * orchestrator 按分数降序 + 依赖关系排序后依次执行。
   * 每轮结束时由 orchestrator 清空（设为 []），下一轮由 intentRouter 重新设置。
   */
  labels: Annotation<LabelItem[]>({
    reducer: (a: LabelItem[], b: LabelItem[]) => b,
    default: () => [],
  }),

  /**
   * userId — 用户唯一标识
   *
   * 当前用户的 ID。由 ai-customer.service.ts 在创建对话时传入。
   * 所有工具调用（查余额、查订单等）都需要 userId 作为参数。
   */
  userId: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * debug — 调试模式开关
   *
   * true 时 Agent 会输出完整的消息链到 agentSteps，方便调试。
   * 由外部调用时传入（如 testChat API）。
   */
  debug: Annotation<boolean>({
    reducer: (a: boolean, b: boolean) => b,
    default: () => false,
  }),

  /**
   * flowState — Active multi-step flow tracking
   *
   * Tracks the current active business flow across graph invocations.
   * Set by orchestrator when labels indicate a multi-step process
   * (e.g. withdrawal, address-add, address-update).
   * Cleared when a topic switch is detected or flow completes.
   * Used by intentRouter as a strong hint for ambiguous follow-ups.
   *
   * Schema:
   * - activeFlow: string — flow identifier ('withdrawal', 'address-add', etc.) or '' if none
   * - step: string    — current step in the flow ('confirm', 'otp', 'fill-field', etc.)
   * - data: object    — accumulated flow data (partial form fields, etc.)
   */
  flowState: Annotation<{
    activeFlow: string;
    step: string;
    data: Record<string, any>;
  }>({
    reducer: (a, b) => b,
    default: () => ({ activeFlow: '', step: '', data: {} }),
  }),
});
