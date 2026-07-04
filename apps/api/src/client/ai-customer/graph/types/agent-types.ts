/**
 * Agent 执行步骤的记录
 * 每次 agent 循环结束后，记录本次执行的统计信息
 * 用于前端展示「思考链」和调试
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
 * 多标签分类结果项
 */
export interface LabelItem {
  /** 意图标签名，如 'order', 'wallet', 'coupon', 'product' 等 */
  label: string;
  /** 置信度分数 0.0-1.0 */
  score: number;
}

/**
 * Agent Node 统一返回类型
 *
 * 所有 agent node（order、wallet 等）都必须返回此形状，
 * 确保下游 answerSynthesizer 能统一消费。
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
}
