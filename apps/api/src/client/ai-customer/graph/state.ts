import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { AgentStep } from '@api/client/ai-customer/graph/types/agent-types';

/**
 * 因为 LangGraph 支持 并行 Node（多个 Node 同时修改同一个 State）。如果没有 Reducer，两个 Node 同时写 messages 就会冲突。有了 Reducer，LangGraph 知道「追加就是安全的合并」。
 * Annotation.Root() 里定义的每个属性都是一个 Annotation，Annotation 是 LangGraph 的状态管理单元。每个 Annotation 都有自己的 reducer 和默认值。
 * 1. messages: 保存所有的对话消息，HumanMessage 和 AIMessage 都会被追加到这个数组里。
 * 2. intent: 保存用户当前的意图，Intent Router Node 会根据用户输入更新这个值。
 * 3. agentSteps: 保存 Agent 每一步的执行日志，前端可以用来展示 Agent 的思考过程。
 * 4. sources: 保存 RAG Node 检索到的知识文档来源，前端可以用来展示信息来源。
 * @param a 旧值，当前 state 中已有的值
 * @param b 新值，Node 正在写入的值
 *
 * 假设 intent 字段的 State 变化过程：
 *
 * // 初始状态（default: () => ''）
 * state.intent = ''
 *
 * // Step 1: Intent Router Node 写入 'order'
 * // LangGraph 内部调用: reducer('', 'order')
 * //  a b
 * // 执行 (a, b) => b → 返回 'order'
 * // 结果: state.intent = 'order'
 *
 * // Step 2: 另一个 Node 写入 'wallet'
 * // LangGraph 内部调用: reducer('order', 'wallet')
 * //                                a       b
 * // 执行 (a, b) => b → 返回 'wallet'
 * // 结果: state.intent = 'wallet' （旧值 'order' 被覆盖）
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
  //结果可能是：'order' / 'wallet' / 'coupon' / 'knowledge' / 'general'
  //因为意图是唯一值（用户当前只能有一种意图），所以用覆盖 reducer
  intent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),
  ////记录 Agent 每一步做了什么（比如：调用了什么工具、查了什么数据库、得到了什么结果）
  //每个 Node 都可以往里面追加自己的执行日志
  //用途：前端 SSE 流式输出「思考链」，让用户看到 Agent 正在思考
  agentSteps: Annotation<AgentStep[]>({
    reducer: (a: AgentStep[], b: AgentStep[]) => a.concat(b),
    default: () => [],
  }),
  agentOutput: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
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
});
