/**
 * extractUserInput — 从 state.messages 中提取最后一条用户消息的纯文本内容
 *
 * ── 为什么需要这个工具？ ──
 * 在 intentRouter、orchestrator 等多个节点中，重复出现相同的 5 行样板代码：
 *
 *   const lastMessage = state.messages[state.messages.length - 1];
 *   const userInput =
 *     typeof lastMessage?.content === 'string'
 *       ? lastMessage.content
 *       : JSON.stringify(lastMessage?.content ?? '');
 *
 * 此工具函数统一了上述逻辑，处理 content 为 string / 复杂对象 / null 三种情况。
 *
 * ── 为什么用 typeof AgentState.State 而不是具体类型？ ──
 * AgentState.State 是 LangGraph state 的运行时类型，各节点函数的入参都使用它。
 * 保持一致的引用方式可以避免类型不匹配。
 */
import type { AgentState } from '@api/client/ai-customer/graph/state';

export function extractUserInput(
  state: typeof AgentState.State,
): string {
  const lastMessage = state.messages[state.messages.length - 1];
  return typeof lastMessage?.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage?.content ?? '');
}
