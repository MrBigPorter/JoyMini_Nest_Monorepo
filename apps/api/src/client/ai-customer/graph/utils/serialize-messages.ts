/**
 * 将 BaseMessage[] 序列化为可 JSON 序列化的对象数组
 * 用于 debug mode 输出完整 LLM 上下文
 */
import { BaseMessage } from '@langchain/core/messages';

export interface SerializedMessage {
  type: string;
  content: string;
  tool_calls?: Array<{
    name: string;
    args: Record<string, any>;
    id: string;
  }>;
  tool_call_id?: string;
  additional_kwargs?: Record<string, any>;
}

export function serializeMessages(
  messages: any[],
): SerializedMessage[] {
  return messages.map((msg) => {
    // Support both BaseMessage instances (_getType()) and plain objects (role)
    const type =
      typeof msg._getType === 'function' ? msg._getType() : msg.role ?? 'unknown';
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : typeof msg.content === 'object' && msg.content !== null
          ? JSON.stringify(msg.content)
          : String(msg.content ?? '');
    const base: SerializedMessage = {
      type,
      content,
      additional_kwargs: msg.additional_kwargs ?? {},
    };
    const toolCalls = (msg as any).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      base.tool_calls = toolCalls.map((tc: any) => ({
        name: tc.name,
        args: tc.args,
        id: tc.id ?? tc.tool_call_id ?? '',
      }));
    }
    const toolCallId = (msg as any).tool_call_id;
    if (toolCallId) {
      base.tool_call_id = toolCallId;
    }
    return base;
  });
}
