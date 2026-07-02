import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { AgentStep } from '@api/client/ai-customer/graph/types/agent-types';
import {
  FlowType,
  FlowStatus,
  getInitialStatus,
} from '@api/client/ai-customer/graph/types/flow-types';

/**
 * ================================================================
 * AgentState — LangGraph 状态定义（14 个字段）
 * ================================================================
 *
 * Annotation.Root() 里定义的每个属性都是一个 Annotation，Annotation 是 LangGraph 的状态管理单元。
 * 每个 Annotation 都有自己的 reducer 和默认值。
 *
 * LangGraph 支持并行 Node，如果没有 Reducer，两个 Node 同时写一个字段会冲突。
 * 有了 Reducer，LangGraph 知道如何合并。
 *
 * Reducer 类型说明：
 * - replace (a, b) => b：覆盖旧值（intent, flowType, flowStatus 等）
 * - merge  ({...a, ...b})：合并对象（flowData, taskResults）
 * - concat a.concat(b)：追加数组（messages, agentSteps, sources）
 *
 * ===== 14 个字段概览 =====
 *
 * ## 核心对话（3 个）
 * 1. messages:      对话消息列表（messagesStateReducer 自动追加）
 * 2. intent:        当前意图（intentRouter 设置，answerSynthesizer 每轮清空）
 * 3. userId:        用户唯一标识（由 ai-customer.service.ts 传入）
 *
 * ## Supervisor 多 Agent（4 个）
 * 4. pendingTasks:  待处理的多 Agent 任务列表（非空 = supervisor 模式）
 * 5. taskResults:   子 Agent 执行结果汇总（merge reducer，answerSynthesizer 可清空）
 * 6. supervisorRound: 轮次计数器（防止死循环）
 * 7. agentSteps:    Agent 执行日志（前端 SSE 展示思考链用）
 *
 * ## RAG（1 个）
 * 8. sources:       知识文档来源（可追加，用于前端展示信息来源）
 *
 * ## Phase 1 — Flow 状态管理（4 个）
 * 9. flowType:      业务类型（DEPOSIT/WITHDRAWAL 等，Agent 提示词中展示）
 * 10. flowStatus:    流程状态（IDLE/FILLING/CONFIRMING 等，由工具更新）
 * 11. flowData:      表单数据（slot filling，merge reducer）
 * 12. currentAgent:  当前 Agent 名称（用于中断恢复，Phase 3 预留）
 *
 * ## Phase 2 — 路由缓存（1 个）
 * 13. routeCache:    缓存上一轮路由结果，answerSynthesizer 不清空（跳过 LLM 分类）
 *
 * ## 调试（1 个）
 * 14. debug:         调试模式开关
 */
export const AgentState = Annotation.Root({
  //LangGraph 内置的 reducer，自动追加新消息，不会覆盖旧消息
  //用户每说一句话 → 一个 HumanMessage 被追加
  //Agent 每回复一句话 → 一个 AIMessage 被追加
  //因为用了 messagesStateReducer，所有消息都保留，不会丢失历史
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  //流水线第一站「Intent Router Node」会判断用户意图
  //结果可能是：'order' / 'wallet' / 'coupon' / 'knowledge' / 'general' / 'supervised'
  //因为意图是唯一值（用户当前只能有一种意图），所以用覆盖 reducer
  intent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),
  // Supervisor: 待处理的多 Agent 任务列表
  // 非空 = 当前在 supervisor 模式（多 Agent 协作）
  // 空数组 = 不在 supervisor 模式（单 Agent）
  // isSupervised 字段已移除——用 pendingTasks.length > 0 替代
  pendingTasks: Annotation<Array<{ agent: string; description: string }>>({
    reducer: (a, b) => b,
    default: () => [],
  }),
  // Supervisor: 子 Agent 执行结果汇总
  // 使用覆盖 reducer，answerSynthesizer 可以通过 taskResults: {} 清空旧结果
  taskResults: Annotation<Record<string, any>>({
    reducer: (a, b) => {
      if (Object.keys(b).length === 0) return {};
      return { ...a, ...b };
    },
    default: () => ({}),
  }),
  // Supervisor: 执行轮次（防止死循环）
  supervisorRound: Annotation<number>({
    reducer: (a: number, b: number) => b,
    default: () => 0,
  }),
  ////记录 Agent 每一步做了什么（比如：调用了什么工具、查了什么数据库、得到了什么结果）
  //每个 Node 都可以往里面追加自己的执行日志
  //用途：前端 SSE 流式输出「思考链」，让用户看到 Agent 正在思考
  agentSteps: Annotation<AgentStep[]>({
    reducer: (a: AgentStep[], b: AgentStep[]) => a.concat(b),
    default: () => [],
  }),
  // 当用户问商品政策、退货规则等问题时
  //RAG Node 会去数据库检索相关的知识文档
  //检索结果被追加到 sources 数组
  //用途：前端可以展示「信息来源：xxxx」，增加可信度
  sources: Annotation<any[]>({
    reducer: (a: any[], b: any[]) => a.concat(b),
    default: () => [],
  }),
  //用户的唯一标识，用于区分不同用户的对话状态
  userId: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),
  // ============================================================
  // Phase 1 — Flow 状态管理（强类型）
  // ============================================================
  /** 当前业务类型（如 DEPOSIT、WITHDRAWAL、ORDER_QUERY 等） */
  flowType: Annotation<FlowType>({
    reducer: (a: FlowType, b: FlowType) => b,
    default: () => '' as FlowType,
  }),
  /** 当前业务流程状态（如 IDLE、FILLING、CONFIRMING 等） */
  flowStatus: Annotation<FlowStatus>({
    reducer: (a: FlowStatus, b: FlowStatus) => b,
    default: () => 'IDLE' as FlowStatus,
  }),
  /** 业务流程数据（slot filling 表单数据、中间结果等），使用 merge reducer */
  flowData: Annotation<Record<string, any>>({
    reducer: (a: Record<string, any>, b: Record<string, any>) => {
      // undefined/null = 节点未指定 flowData，保持现有数据不变
      if (b == null) return a;
      // 空对象 = 显式清空（话题切换时 intentRouter 传入 {}）
      if (Object.keys(b).length === 0) return {};
      // 正常合并（agent 通过 updateFlowData 逐步填充）
      return { ...a, ...b };
    },
    default: () => ({}),
  }),
  /** 当前正在执行的 Agent 名称（用于日志和中断恢复） */
  currentAgent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),
  // ============================================================
  // Phase 2 — Route Cache（缓存上一轮路由结果）
  // ============================================================
  /** 路由缓存：缓存上一轮的 intent 分类结果，answerSynthesizer 不清空此字段 */
  routeCache: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),
  // ============================================================
  // Phase 3 — Message Topic Tracking（Human 消息按话题标记）
  // ============================================================
  /** 消息话题标记：记录每条 Human 消息被 intentRouter 分类时的 intent。
   *  key = 消息在 state.messages 中的索引
   *  value = intentRouter 分类结果（如 'coupon', 'wallet', 'supervised'）
   *  用于 supervisor 模式下按话题过滤 Human 消息，防止跨话题污染 */
  messageTopics: Annotation<Record<number, string>>({
    reducer: (a: Record<number, string>, b: Record<number, string>) => ({
      ...a,
      ...b,
    }),
    default: () => ({}),
  }),
  debug: Annotation<boolean>({
    reducer: (a: boolean, b: boolean) => b,
    default: () => false,
  }),
});
