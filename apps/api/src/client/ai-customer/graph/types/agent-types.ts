/**
 * Agent 执行步骤的记录
 * 每次 agent 循环结束后，记录本次执行的统计信息
 * 用于前端展示「思考链」和调试
 *
 * 什么是 Supervisor？
 * Supervisor = 主管。当用户一次性问多个不同领域的问题时（如 "查余额和订单"），普通工人答不了，因为：
 *
 * orderAgent（订单工人）只会查订单，不会查钱包
 * walletAgent（钱包工人）只会查钱包，不会查订单
 * 所以需要一个 主管（Supervisor） 来做两件事：
 *
 * Step 1：分解任务
 * 把 "查余额和订单" 分解成：
 *
 * 任务 1：walletAgent → 查余额
 * 任务 2：orderAgent → 查订单
 * Step 2：派发任务
 * 依次叫每个工人干活，收集他们的结果。
 *
 * 用户: "查余额和订单"
 *   │
 *   ▼
 * IntentRouter（分拣员）→ 识别出"需要主管"
 *   │
 *   ▼
 * SupervisorNode（主管）→ 分解：walletAgent + orderAgent
 *   │
 *   ├── 第1轮 → walletAgent（查余额）→ 写结果到 taskResults.walletAgent
 *   │         └── 回主管 → 派下一任务
 *   │
 *   ├── 第2轮 → orderAgent（查订单）→ 写结果到 taskResults.orderAgent
 *   │         └── 回主管 → 没有任务了
 *   │
 *   ▼
 * AnswerSynthesizer（包装员）→ 看到 taskResults 里有钱包数据 + 订单数据
 *   │
 *   ▼
 * "亲，您的余额是 500 PHP，您最近的订单是 JOY2024001..."
 */
import { BaseMessage } from '@langchain/core/messages';
import { AgentState } from '@api/client/ai-customer/graph/state';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { SerializedMessage } from '@api/client/ai-customer/graph/utils/serialize-messages';

export interface AgentStep {
  /** 节点名称，如 'orderAgent'、'walletAgent' */
  node: string;
  /** 本轮总共调用了几次 tool */
  totalToolCalls: number;
  /** 循环迭代次数 */
  iterations: number;
  /** 最后一次调用的 tool 信息（如果有），包含结果 */
  lastToolCall: {
    name: string;
    args: Record<string, any>;
    result?: string;
  } | null;
  /** agent 内部总消息数 */
  totalMessages: number;
  /** debug=true 时，保存完整的消息序列 */
  messages?: SerializedMessage[];
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
  /** Agent 生成的纯文本回答 → 按 agent 名存入 taskResults */
  taskResults: Record<string, string>;
  /** 保留原始的输入消息（而非 agent 内部消息） */
  messages: BaseMessage[];
  /** Agent 执行步骤日志 */
  agentSteps: AgentStep[];
}

/**
 * Agent Node 类型定义
 *
 * 所有 agent node（order、wallet 等）都必须实现此函数签名，
 * 确保下游 answerSynthesizer 能统一消费。
 */
export type AgentNode = (
  state: typeof AgentState.State,
) => Promise<AgentNodeOutput>;

/**
 * Agent Node 工厂类型定义
 *
 * 用于创建不同类别的 agent node（order、wallet 等）。
 * 传入 LLM 配置和工具注册表，返回对应的 agent node 函数。
 */
export type AgentNodeFactory = (
  llmConfig: LlmProviderConfig,
  registry: ToolRegistryService,
) => AgentNode;

/**
 * 测试用的 Agent Node 输出类型
 */
export interface TestChatResult {
  intent: string;
  agentOutput: string;
  debug: {
    toolCalls: number;
    lastToolCall: { name: string; args: Record<string, any>; result?: string } | null;
    totalMessages: number;
  };
  /** debug=true 时返回 */
  agentSteps?: AgentStep[];
}
