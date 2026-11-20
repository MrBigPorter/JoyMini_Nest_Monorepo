import {
  CONTEXT_TOKEN_BUDGET,
  MIN_CONTEXT_MESSAGES,
} from '@api/client/ai-customer/graph/constants';
import { ConversationContextState } from '@api/client/ai-customer/graph/state';

/**
 * 粗估 token：英文约 4 chars/token，中文更密（约 1.5 chars/token）。
 * 这里宁可高估，预算是上限而不是目标值。
 */
export function estimateTokens(message: any): number {
  if (!message) return 0;
  let chars = 0;
  const content = message.content;
  if (typeof content === 'string') {
    chars += content.length;
  } else if (Array.isArray(content)) {
    chars += JSON.stringify(content).length;
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    chars += JSON.stringify(message.tool_calls).length;
  }
  if (message.additional_kwargs) {
    chars += JSON.stringify(message.additional_kwargs).length;
  }
  return Math.ceil(chars / 2.5) + 8;
}

/**
 * 把消息按“AI tool_call + 其后的 ToolMessage”分组。
 * 裁剪以组为单位，绝不把调用和结果切开。
 */
export function groupMessages(messages: any[]): any[][] {
  const groups: any[][] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const group = [message];
    if (isToolCallMessage(message)) {
      let j = i + 1;
      while (j < messages.length && messages[j]?.type === 'tool') {
        group.push(messages[j]);
        j += 1;
      }
      i = j - 1;
    }
    groups.push(group);
  }
  return groups;
}

/**
 * 按 token 预算保留最近的消息组。
 *
 * - system prompt 由 buildInitialMessages 单独传入，不在这里裁剪
 * - 最近 MIN_CONTEXT_MESSAGES 条消息强制保留（最后组即使超预算也保留）
 * - 丢弃更早的完整组，避免孤立 ToolMessage
 */
export function trimContextToBudget(
  messages: any[],
  options: { maxTokens?: number; minRecent?: number } = {},
): any[] {
  if (!messages || messages.length === 0) return [];

  const maxTokens = options.maxTokens ?? CONTEXT_TOKEN_BUDGET;
  const minRecent = options.minRecent ?? MIN_CONTEXT_MESSAGES;
  const groups = groupMessages(messages);

  const selected: any[][] = [];
  let usedTokens = 0;
  let usedMessages = 0;

  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    const groupTokens = group.reduce(
      (sum, message) => sum + estimateTokens(message),
      0,
    );
    const mustKeep = usedMessages < minRecent;

    if (!mustKeep && usedTokens + groupTokens > maxTokens) {
      break;
    }

    selected.unshift(group);
    usedTokens += groupTokens;
    usedMessages += group.length;
  }

  const flattened = selected.flat();
  // 输入本身可能以孤立 ToolMessage 开头（历史遗留），丢掉它。
  let start = 0;
  while (start < flattened.length && flattened[start]?.type === 'tool') {
    start += 1;
  }
  return flattened.slice(start);
}

/**
 * 结构化摘要：优先保留实体与纠正，不生成泛化叙述，也就不存在“摘要丢细节”。
 * 作为独立 SystemMessage 注入，不写进 state.messages。
 */
export function formatContextSummary(
  state: ConversationContextState | undefined,
  pendingConfirm?: { action?: string } | null,
): string {
  if (!state) return '';
  const lines: string[] = [];

  if (state.activeEntity) {
    lines.push(`activeEntity: ${state.activeEntity}`);
  }
  if (state.corrections.length > 0) {
    const recent = state.corrections
      .slice(-3)
      .map((item) => `${item.from || '(未指明)'} -> ${item.to}`)
      .join('; ');
    lines.push(`corrections: ${recent}`);
  }
  if (Object.keys(state.slots).length > 0) {
    lines.push(`slots: ${JSON.stringify(state.slots)}`);
  }
  if (state.unresolved.length > 0) {
    lines.push(`unresolved: ${state.unresolved.join('; ')}`);
  }
  if (pendingConfirm?.action) {
    lines.push(`pendingConfirm: ${pendingConfirm.action}`);
  }

  if (lines.length === 0) return '';
  return `## Current Conversation Context\n${lines.join('\n')}`;
}

function isToolCallMessage(message: any): boolean {
  return (
    message?.type === 'ai' &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}
