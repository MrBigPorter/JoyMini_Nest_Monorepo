/**
 * 评测 evaluator 的输入/输出契约（Phase 1）。
 *
 * 只依赖纯数据结构，不依赖 Prisma / Nest，方便离线 runner 和单测复用。
 */

export type MessageRole = 'user' | 'ai' | 'human_agent' | 'system';

export interface EvalMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  /** AI 回复对应的用户消息 id；人工客服消息可能为 null。 */
  triggerMessageId?: string | null;
}

export interface EvalTrace {
  id: string;
  triggerMessageId?: string | null;
  aiMessageId?: string | null;
  createdAt: Date;
}

export type EvalStatus = 'pass' | 'fail' | 'unknown';

export interface EvalFeedback {
  key: string;
  /** 用户消息的序号，从 1 开始。 */
  turn: number;
  status: EvalStatus;
  score: number | null;
  comment: string;
}

export interface ConversationSnapshot {
  conversationId: string;
  source: 'real' | 'sim' | 'drill' | 'unknown';
  messages: EvalMessage[];
  traces: EvalTrace[];
}

export interface EvaluatorOptions {
  maxLatencyMs: number;
}

export const DEFAULT_MAX_LATENCY_MS = 10_000;

export interface EvaluatorDefinition {
  key: string;
  version: string;
  scoreType: 'boolean' | 'continuous';
  description: string;
}

export const DETERMINISTIC_EVALUATORS: EvaluatorDefinition[] = [
  {
    key: 'language_match',
    version: '1.0.0',
    scoreType: 'boolean',
    description: 'AI 回复语言与用户提问一致',
  },
  {
    key: 'answered',
    version: '1.0.0',
    scoreType: 'boolean',
    description: '每条用户消息有 AI/人工终态回复',
  },
  {
    key: 'latency',
    version: '1.0.0',
    scoreType: 'boolean',
    description: '用户消息到首条 AI 回复不超过阈值',
  },
  {
    key: 'trace_present',
    version: '1.0.0',
    scoreType: 'boolean',
    description: '该轮 AI 回复有对应 trace',
  },
  {
    key: 'sensitive_request',
    version: '1.0.0',
    scoreType: 'boolean',
    description: 'AI 回复未索要卡号/身份证/密码等敏感信息',
  },
];
