/**
 * 消息过滤工具
 * 统一管理 Agent 上下文消息的过滤逻辑
 *
 * 使用场景:
 * - 单 Agent 模式: 保留 Human + AI 纯文本，过滤 tool/tool_calls 消息
 * - Supervisor 多 Agent 模式: 额外过滤其他 Agent 的 AI 纯文本输出，防止上下文污染
 */
import { BaseMessage } from '@langchain/core/messages';

/**
 * 过滤 Agent 上下文消息
 * @param messages state.messages 中的全部消息
 * @param pendingTasks 待处理的多 Agent 任务列表（非空 = supervisor 模式）
 * @returns 过滤后的消息数组（不含 tool 和跨 Agent AI 纯文本）
 */
export function filterAgentMessages(
  messages: BaseMessage[],
  pendingTasks: Array<{ agent: string; description: string }>,
): BaseMessage[] {
  const isSupervised = pendingTasks.length > 0;
  // ---------------------------------------------------------------
  // 单 Agent 模式下，保留最后一个 ToolMessage + 其对应的 AI(tool_calls)
  // ---------------------------------------------------------------
  // 原因:
  // 1. 让 LLM 看到上一次工具调用的返回值，避免在下一轮中重复调用同一个 tool
  // 2. OpenAI/DeepSeek API 强制要求: ToolMessage 必须紧跟在包含匹配
  //    tool_call_id 的 AI(tool_calls) 消息之后；缺少此约束会导致:
  //    "Messages with role 'tool' must be a response to a preceding
  //     message with 'tool_calls'" (400 BadRequest)
  let lastToolIdx = -1;
  let lastToolCallerIdx = -1;

  if (!isSupervised) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const type = (messages[i] as any)._getType?.() ?? '';
      // 从后往前找最后一个 ToolMessage
      if (type === 'tool' && lastToolIdx === -1) {
        lastToolIdx = i;
      }
      // 找到最后一个 ToolMessage 前面最近的 AI(tool_calls)
      if (
        type === 'ai' &&
        (messages[i] as any).tool_calls?.length &&
        lastToolIdx !== -1 &&
        lastToolCallerIdx === -1 &&
        i < lastToolIdx
      ) {
        lastToolCallerIdx = i;
      }
    }
  }

  const filtered = messages.filter((msg, idx) => {
    const type = (msg as any)._getType?.() ?? '';

    // ---- Supervisor 模式: 过滤所有 tool / tool_calls / 跨 Agent AI ----
    if (isSupervised) {
      if (type === 'tool') return false;
      if (type === 'ai' && !(msg as any).tool_calls?.length) return false;
      if (type === 'ai' && (msg as any).tool_calls?.length) return false;
      return true; // 只保留 Human 消息
    }

    // ---- 单 Agent 模式 ----

    // 工具消息 → 只保留最后一个（用于上下文，让 LLM 看到上次调用的结果）
    if (type === 'tool') {
      return idx === lastToolIdx;
    }

    // 带 tool_calls 的 AI 消息 → 只保留最后一个 ToolMessage 对应的调用者
    // 其他都过滤掉（历史 tool_calls 对当前轮次无意义）
    if (type === 'ai' && (msg as any).tool_calls?.length) {
      return idx === lastToolCallerIdx;
    }

    // 保留 Human 消息和 AI 纯文本回复
    return true;
  });

  return filtered;
}
