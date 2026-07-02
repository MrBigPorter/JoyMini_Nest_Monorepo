/**
 * 消息过滤工具
 * 统一管理 Agent 上下文消息的过滤逻辑
 *
 * 使用场景:
 * - 单 Agent 模式: 保留 Human + AI 纯文本，过滤 tool/tool_calls 消息
 * - Supervisor 多 Agent 模式: 额外过滤其他 Agent 的 AI 纯文本输出 + 按话题过滤 Human 消息
 */
import { BaseMessage } from '@langchain/core/messages';

/**
 * Agent 名称 → 话题（intent）映射表
 * 用于 supervisor 模式下按话题过滤 Human 消息
 */
const agentToTopic: Record<string, string> = {
  orderAgent: 'order',
  walletAgent: 'wallet',
  couponAgent: 'coupon',
  userAgent: 'user',
  productAgent: 'product',
  luckyAgent: 'lucky-draw',
  ragNode: 'rag',
  generalChat: 'general',
  supervisorNode: 'supervised',
};

/**
 * 过滤 Agent 上下文消息
 * @param messages state.messages 中的全部消息
 * @param pendingTasks 待处理的多 Agent 任务列表（非空 = supervisor 模式）
 * @param messageTopics 消息话题标记（可选），key=消息索引，value=intent
 * @param currentAgent 当前 Agent 名称（可选），如 'walletAgent'
 * @returns 过滤后的消息数组（不含 tool 和跨 Agent AI 纯文本）
 */
export function filterAgentMessages(
  messages: BaseMessage[],
  pendingTasks: Array<{ agent: string; description: string }>,
  messageTopics?: Record<number, string>,
  currentAgent?: string,
): BaseMessage[] {
  const isSupervised = pendingTasks.length > 0;
  // ---------------------------------------------------------------
  // 单 Agent 模式下，保留最后一个 AI(tool_calls) + 其所有对应的 ToolMessage
  // ---------------------------------------------------------------
  // 原因:
  // 1. 让 LLM 看到上一次工具调用的返回值，避免在下一轮中重复调用同一个 tool
  // 2. OpenAI/DeepSeek API 强制要求: AI(tool_calls) 必须跟随匹配的 ToolMessage
  //    "Messages with role 'tool' must be a response to a preceding
  //     message with 'tool_calls'" (400 BadRequest)
  // 3. 如果 AI 调用了多个工具（如 getBalance + getKyc），必须保留所有对应的 ToolMessage，
  //    不能只保留最后一个，否则会触发:
  //    "insufficient tool messages following tool_calls message" (400 BadRequest)
  let lastToolCallerIdx = -1;
  const toolIndicesToKeep = new Set<number>();

  if (!isSupervised) {
    // 从后往前找最后一个 AI(tool_calls)
    for (let i = messages.length - 1; i >= 0; i--) {
      const type = (messages[i] as any)._getType?.() ?? '';
      if (
        type === 'ai' &&
        (messages[i] as any).tool_calls?.length &&
        lastToolCallerIdx === -1
      ) {
        lastToolCallerIdx = i;
      }
    }
    // 如果找到了 AI(tool_calls)，收集它后面所有 ToolMessage
    //（必须全部保留，否则 AI 引用的 tool_call_id 找不到对应响应）
    if (lastToolCallerIdx !== -1) {
      for (let j = lastToolCallerIdx + 1; j < messages.length; j++) {
        const t = (messages[j] as any)._getType?.() ?? '';
        if (t === 'tool') {
          toolIndicesToKeep.add(j);
        } else {
          break; // 遇到非 Tool 消息就停止
        }
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
      // ---- Human 消息: 按话题过滤 ----
      if (type === 'human' && messageTopics && currentAgent) {
        const msgTopic = messageTopics[idx];
        // 没有标记的消息 → 保留（向后兼容）
        if (!msgTopic) return true;
        // 触发 supervisor 的消息（intent='supervised'）→ 按 pendingTasks 二次过滤
        // 只保留给那些被明确分配了子任务的 Agent，避免未被分配任务的 Agent 看到复合查询
        if (msgTopic === 'supervised') {
          if (!currentAgent) return true; // 向后兼容
          return pendingTasks.some(t => t.agent === currentAgent);
        }
        // 只保留与当前 Agent 话题匹配的消息
        const expectedTopic = agentToTopic[currentAgent];
        return msgTopic === expectedTopic;
      }
      return true; // 没有 messageTopics/currentAgent 参数 → 保留所有 Human（向后兼容）
    }

    // ---- 单 Agent 模式 ----

    // 工具消息 → 只保留最后一个 AI(tool_calls) 对应的所有 ToolMessage
    if (type === 'tool') {
      return toolIndicesToKeep.has(idx);
    }

    // 带 tool_calls 的 AI 消息 → 只保留最后一个
    if (type === 'ai' && (msg as any).tool_calls?.length) {
      return idx === lastToolCallerIdx;
    }

    // 保留 Human 消息和 AI 纯文本回复
    return true;
  });

  return filtered;
}
