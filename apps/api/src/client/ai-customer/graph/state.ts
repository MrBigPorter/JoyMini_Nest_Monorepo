/**
 * AgentState — LangGraph State Schema（蓝图 / 类定义）
 *
 * ════════════════════════════════════════════════════════════════
 * 一、Annotation.Root 是什么？
 * ════════════════════════════════════════════════════════════════
 *
 * Annotation.Root({...}) 定义的是 State Schema（状态模式），相当于
 * 面向对象编程中的"类定义（Class）"或 TypeScript 的"interface"。
 * 它不是一个具体的状态实例，而是一个蓝图。
 *
 * 真正的状态实例在 graph.invoke(input) 时由 LangGraph 内部创建。
 * 你可以把 Annotation.Root 理解为：
 *   class AgentState {
 *     messages: BaseMessage[];
 *     intent: string;
 *     userId: string;
 *     // ...
 *   }
 *
 * ════════════════════════════════════════════════════════════════
 * 二、invoke() 如何创建状态实例？
 * ════════════════════════════════════════════════════════════════
 *
 * 当外部调用 graph.invoke(input) 时，LangGraph 内部执行：
 *
 *   const state = {};
 *   for (const [key, field] of Object.entries(Annotation.Root)) {
 *     if (key in input) {
 *       state[key] = field.reducer(field.default(), input[key]);
 *     } else {
 *       state[key] = field.default();
 *     }
 *   }
 *
 * ════════════════════════════════════════════════════════════════
 * 【运行示例 — "那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱"]
 * ════════════════════════════════════════════════════════════════
 *
 * 1. 首次 invoke (ai-customer.service.ts):
 *
 *   compiledGraph.invoke({
 *     messages: [new HumanMessage("那我要买Women Crossbody Bag Set，团购价格多少，加上优惠券，我还有多少钱")],
 *     userId: '123',
 *     debug: true,
 *   }, { configurable: { thread_id: 'session-xyz' } });
 *
 * LangGraph 创建初始 state:
 *   messages: [HumanMessage("那我要买...")]    ← 用户输入
 *   userId:   '123'                            ← 用户 ID
 *   debug:    true                             ← 调试模式
 *   intent:   ''                               ← 默认值
 *   labels:   []                               ← 默认值（稍后由 intentRouter 设置）
 *   flowState:{activeFlow:'',step:'',data:{}}  ← 默认值
 *   previousIntent: ''                         ← 默认值
 *   debugInfo: null                            ← 默认值
 *
 * 2. intentRouter 节点执行后:
 *   intent:   'product'                        ← 最高分域
 *   labels:   [{label:'product',score:0.86},
 *              {label:'coupon', score:0.60},
 *              {label:'wallet', score:0.59}]   ← 多标签
 *   debugInfo.embedding: { method:'embedding', rawTop5:[...], dedupedLabels:[...] }
 *
 * 3. orchestrator 节点执行后:
 *   messages: [...原有, AIMessage(finalContent)]  ← 追加 AI 回复
 *   labels:   []                                    ← 清空，下一轮重新分类
 *   previousIntent: 'product'                       ← 保存本轮主意图
 *   debugInfo.execution: {
 *     executionOrder: ['product','coupon','wallet'],
 *     agents: [{label:'product',tools:['searchProducts',...],...}, ...]
 *   }
 *
 * 4. 第二轮 invoke（假设用户回复 "下单"）:
 *   compiledGraph.invoke({
 *     messages: [new HumanMessage("下单")],
 *   }, { configurable: { thread_id: 'session-xyz' } });
 *
 *   MemorySaver 恢复上轮最终 state，合并新消息:
 *   messages:       [Human("那我要买..."), AI(...), Human("下单")]
 *   intent:         'product'    ← 保留至本轮
 *   labels:         []           ← 空，intentRouter 重新设置
 *   previousIntent: 'product'    ← 上下文提示
 *   debug:          false        ← 第二轮未传 debug（默认 false）
 *
 * 对比单意图例子（旧版 "我要提现"）:
 *   如果只问 "我要提现"，则:
 *   labels: [{label:'wallet', score:0.92}]  ← 仅一个标签
 *   executionOrder: ['wallet']
 *   walletAgent 执行一次 → 无合成步骤
 *
 * 对比无分类例子（闲聊）:
 *   如果只问 "你好"，则:
 *   labels: [] ← embedding 结果都低于 0.5 阈值
 *   orchestrator 走 handleGeneralChat → 直接 LLM 回复
 * ════════════════════════════════════════════════════════════════
 *
 * LangGraph 检查 input 是否包含每个 schema 字段对应的 key：
 *   - messages → 有 → reducer(default(), input.messages)
 *     → messagesStateReducer([], [HumanMessage]) → [HumanMessage]
 *   - userId   → 有 → reducer('', '123') → '123'
 *   - debug    → 有 → reducer(false, true) → true
 *   - intent   → 无 → default() → ''
 *   - labels   → 无 → default() → []
 *   - flowState→ 无 → default() → { activeFlow: '', step: '', data: {} }
 *
 * ════════════════════════════════════════════════════════════════
 * 三、Reducer 是什么？
 * ════════════════════════════════════════════════════════════════
 *
 * Reducer 是一个函数 (oldValue, newValue) => mergedValue。
 * 当 Node 返回部分 state 更新时，LangGraph 对每个字段调用 reducer，
 * 将旧值和新值合并。
 *
 * 两种常见模式：
 *   1. (a, b) => b           — 直接替换（intent, userId 等标量字段）
 *      例如：node 返回 { intent: 'wallet' }
 *            => reducer('旧值', 'wallet') => 'wallet'
 *
 *   2. messagesStateReducer  — 自动追加（messages 数组字段）
 *      这是 LangChain 内置的 reducer，自动将新消息追加入数组
 *      并处理角色交替、工具调用消息关联等逻辑。
 *      例如：node 返回 { messages: [AIMessage(...)] }
 *            => messagesStateReducer([HumanMessage], [AIMessage])
 *            => [HumanMessage, AIMessage]
 *
 * ════════════════════════════════════════════════════════════════
 * 四、Node 如何读写 State？
 * ════════════════════════════════════════════════════════════════
 *
 * - 读取：Node 函数的第一个参数是当前完整 state。
 *   通过解构可以取到任意字段：async (state: typeof AgentState.State) => { ... }
 *   const { messages, userId, intent } = state;
 *
 * - 写入：Node 函数返回一个 Partial<typeof AgentState.State>。
 *   LangGraph 对返回对象的每个 key 调用对应的 reducer 合并到 state。
 *   返回值中缺失的字段不更新。
 *
 *   例如：
 *     async function orchestratorNode(state) {
 *       const result = await runAgent(state);
 *       return {
 *         messages: [result.aiMessage],  // => messagesStateReducer
 *         labels: [],                     // => (a,b) => b => 清空 labels
 *       };
 *       // intent、userId 等未返回的字段保持不变
 *     }
 *
 * ════════════════════════════════════════════════════════════════
 * 五、MemorySaver 如何跨轮持久化？
 * ════════════════════════════════════════════════════════════════
 *
 * MemorySaver 是一个 Checkpointer，在每次 Node 执行后保存 state
 * 快照到内存（或数据库）。当使用相同 thread_id 再次 invoke 时：
 *
 *   1. LangGraph 从 MemorySaver 加载上一轮的最终 state
 *   2. 将新 input 中的字段通过 reducer 合并到已恢复的 state 上
 *   3. 从上次结束的节点继续执行
 *
 *   例如第二轮 invoke：
 *     input: { messages: [new HumanMessage("确认")] }
 *     已恢复 state: { messages: [Human, AI], intent: 'wallet', labels: [...], ... }
 *     合并后: { messages: [Human, AI, Human("确认")], intent: 'wallet', ... }
 *
 * 这意味着：
 *   - intent/labels 在第二轮开始时仍然保留上一轮的值
 *   - intentRouter 可以看到上一轮的分类结果，结合新消息做上下文判断
 *   - flowState.activeFlow 也保留，帮助意图路由理解"确认"指的是什么
 *
 * ════════════════════════════════════════════════════════════════
 * 六、和旧架构的区别（14 字段 -> 7 字段）
 * ════════════════════════════════════════════════════════════════
 *
 * 旧架构: messages, intent, previousIntent, pendingTasks, taskResults,
 *         supervisorRound, agentSteps, sources, userId,
 *         flowType, flowStatus, flowData, currentAgent, messageTopics, debug
 * 新架构: messages, intent, previousIntent, userId, labels, debug, flowState
 *
 * -- 被删除的字段及其替代方案 --
 * - pendingTasks:       Orchestrator 用 labels[] 直接决定执行顺序
 * - taskResults:        Orchestrator 内部管理 agent 输出
 * - supervisorRound:    不再是 supervisor 模式，无需轮次计数
 * - agentSteps:         不再写入 state，由 Orchestrator 内部处理
 * - sources:            由 Orchestrator 内部传递
 * - flowType/flowStatus/flowData/currentAgent:
 *   合并为 flowState 一个字段，wallet agent 通过
 *   flowDataAccumulator 在运行期间内部管理
 * - messageTopics:      所有 Agent 共享完整上下文，无需按话题过滤
 */
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { LabelItem } from '@api/client/ai-customer/graph/types/agent-types';

// ============================================================
// Debug Info Types — 完整流水线追踪
// ============================================================

/**
 * Embedding 阶段的 debug 信息
 */
export interface DebugEmbeddingInfo {
  method: string;
  rawTop5: { domain: string; similarity: number }[];
  dedupedLabels: { label: string; score: number }[];
}

/**
 * 单个 Agent 执行的 debug 信息
 */
export interface DebugAgentExecution {
  label: string;
  tools: string[];
  contextMessages: number;
  lastMsg: string;
  status: 'OK' | 'ERROR';
  resultPreview: string;
}

/**
 * 执行阶段的 debug 信息
 */
export interface DebugExecutionInfo {
  executionOrder: string[];
  agents: DebugAgentExecution[];
}

/**
 * 完整 debug 流水线追踪
 */
export interface DebugInfo {
  embedding: DebugEmbeddingInfo;
  execution: DebugExecutionInfo;
}

// ============================================================
// AgentState — LangGraph State Schema
// ============================================================

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
   * debugInfo — 完整流水线追踪数据
   *
   * 仅在 debug=true 时写入。
   * embedding: 原始 pgvector TOP-5 + 去重后的 labels
   * execution: 执行顺序 + 每个 Agent 的输入/输出快照
   *
   * intentRouter 写入 embedding 部分，
   * orchestrator 写入 execution 部分，
   * ai-customer.service 在 debug=true 时读取并返回。
   */
  debugInfo: Annotation<DebugInfo | null>({
    reducer: (a: DebugInfo | null, b: DebugInfo | null) => b,
    default: () => null,
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

  /**
   * entryPoint — 用户入口上下文
   *
   * 用户从哪个业务页面进入客服，如 'order_detail' / 'deposit' / 'profile'。
   * intentRouter 可用此信息辅助意图分类（如从订单页进入则优先 order 意图）。
   */
  entryPoint: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),

  /**
   * entryMetadata — 业务元数据
   *
   * 从业务页面传入的上下文数据，如 { orderId: 'xxx' }。
   * intentRouter 和 orchestrator 可根据此数据自动执行相关操作。
   */
  entryMetadata: Annotation<Record<string, any>>({
    reducer: (a: Record<string, any>, b: Record<string, any>) => b,
    default: () => ({}),
  }),

  /**
   * transferToHuman — 转人工标记
   *
   * orchestrator 在以下情况设置为 true：
   * 1. LLM 判断需要转人工（用户情绪激动、要求投诉等）
   * 2. 工具调用连续失败
   * AiCustomerService 收到此标记后 SSE 发 transfer 事件并通知管理员。
   */
  transferToHuman: Annotation<boolean>({
    reducer: (a: boolean, b: boolean) => b,
    default: () => false,
  }),
  /**
   * pendingConfirm — 待确认操作
   *
   * orchestrator 在以下情况设置：
   * 1. 用户发起需要确认的操作（如提现、修改地址等）
   * 2. orchestrator 生成确认摘要和参数，存入 pendingConfirm
   * AiCustomerService 收到此标记后 SSE 发 confirm 事件给前端。
   *
   * ⚠️ reducer 用 `(a, b) => b`（而非 `b ?? a`）：
   * 这是"每轮一次性"字段 —— 本轮生成确认就是对象，没生成就是 null。
   * 如果 `b` 为 null 时保留旧值 `a`，上一轮的确认会跨轮残留，
   * 导致下一轮误弹旧的确认卡片（如"取款"弹出上一轮的"领券"卡）。
   * orchestrator 每个返回路径都必须显式带 pendingConfirm（对象或 null），
   * 由 OrchestratorStateUpdate 类型在编译期强制保证。
   */
  pendingConfirm: Annotation<{
    action: string;
    params: Record<string, any>;
    summary: Record<string, any>;
  } | null>({
    reducer: (a, b) => b,
    default: () => null,
  }),

  /**
   * repeatCount — 连续重复意图计数
   *
   * orchestrator 在每轮结束时检查 state.intent 是否与 state.previousIntent 相同。
   * 如果相同，则 repeatCount +1；否则 reset 为 0。
   * intentRouter 可用此计数判断用户是否多次尝试同一意图，辅助转人工决策。
   */
  repeatCount: Annotation<number>({
    reducer: (a: number, b: number) => b,
    default: () => 0,
  }),
});

// ============================================================
// OrchestratorStateUpdate — orchestrator / direct handler 返回类型
// ============================================================

/**
 * OrchestratorStateUpdate — orchestrator 节点及其 direct handler 的返回类型
 *
 * 在 `Partial<typeof AgentState.State>` 基础上，把 pendingConfirm 设为【必填】：
 *  - 本轮生成了确认操作 → 返回确认对象
 *  - 本轮没有确认操作   → 必须返回 null（显式清空，防止跨轮残留）
 *
 * ── 为什么要必填？ ──
 * LangGraph 对 node 返回值中【缺失的字段不调用 reducer】，旧值会原样保留。
 * 之前 pendingConfirm 在非确认路径被省略 → 上一轮的确认跨轮残留
 * （例如"取款"误弹上一轮的"领券"确认卡片）。
 * 把这个字段设为必填后，TypeScript 会在任何返回路径漏掉它时报编译错误，
 * 从类型层面保证 orchestrator 每一轮都显式输出 pendingConfirm（对象或 null）。
 */
export type OrchestratorStateUpdate = Omit<
  Partial<typeof AgentState.State>,
  'pendingConfirm'
> & {
  pendingConfirm: typeof AgentState.State['pendingConfirm'];
};
