/**
 * 将 BaseMessage 格式化为 "Role: content" 预览字符串
 * 用于构建 LLM conversation context
 *
 * ── 使用场景 ──
 * - llmFallback() 中的 conversationContext 构建
 * - 任何需要将消息列表转为纯文本对话历史的场景
 *
 * ── 替换前 ──
 * ```
 * const type = typeof msg._getType === 'function' ? msg._getType() : 'unknown';
 * const role = type === 'human' ? 'User' : type === 'ai' ? 'Assistant' : type;
 * const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
 * const truncated = content.length > 200 ? content.slice(0, 200) + '...' : content;
 * return `${role}: ${truncated}`;
 * ```
 *
 * ── 替换后 ──
 * ```
 * formatMessagePreview(msg, 200)
 * ```
 */
import { BaseMessage } from '@langchain/core/messages';

/**
 * 将消息格式化为 "Role: content" (不截断)
 * 用于 LLM conversation context 等需要完整内容的场景
 */
export function formatMessage(msg: BaseMessage): string {
  const role =
    msg.type === 'human'
      ? 'User'
      : msg.type === 'ai'
        ? 'Assistant'
        : msg.type;
  const content =
    typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content ?? '');
  return `${role}: ${content}`;
}

/**
 * 将消息格式化为 "Role: content" 预览字符串（截断）
 * 用于 debug 日志 / 预览等不需要完整内容的场景
 */
export function formatMessagePreview(
  msg: BaseMessage,
  maxLen = 200,
): string {
  const role =
    msg.type === 'human'
      ? 'User'
      : msg.type === 'ai'
        ? 'Assistant'
        : msg.type;
  const content =
    typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content ?? '');
  const truncated =
    content.length > maxLen ? content.slice(0, maxLen) + '...' : content;
  return `${role}: ${truncated}`;
}
