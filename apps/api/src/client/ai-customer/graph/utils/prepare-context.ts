/**
 * 消息过滤工具
 * 统一管理 Agent 上下文消息的过滤逻辑
 *
 * 使用场景:
 * - 单 Agent 模式: 保留 Human + AI 纯文本，过滤 tool/tool_calls 消息
 * - Supervisor 多 Agent 模式: 额外过滤其他 Agent 的 AI 纯文本输出 + 按话题过滤 Human 消息
 */
import { Logger } from '@nestjs/common';
import { BaseMessage } from '@langchain/core/messages';

const debugLogger = new Logger('PrepareContext');

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

// ================================================================
// Debug 辅助函数
// ================================================================
interface DebugContext {
  isSupervised: boolean;
  lastToolCallerIdx: number;
  toolIndicesToKeep: Set<number>;
  currentAgent?: string;
  messageTopics?: Record<number, string>;
  pendingTasks: Array<{ agent: string; description: string }>;
}

function formatMsgPreview(msg: BaseMessage, idx: number): string {
  const type = (msg as any)._getType?.() ?? 'unknown';
  const tcCount = (msg as any).tool_calls?.length ?? 0;

  let icon: string;
  let role: string;
  let content: string;

  if (type === 'human') {
    icon = '🧑';
    role = 'Human';
    content = String((msg as any).content ?? '').replace(/\n/g, '\\n');
  } else if (type === 'ai' && tcCount > 0) {
    const names = (msg as any).tool_calls.map((tc: any) => tc.name).join(', ');
    icon = '⚡';
    role = `AI(tc=${tcCount})`;
    content = names;
  } else if (type === 'ai') {
    icon = '💬';
    role = 'AI(text)';
    content = String((msg as any).content ?? '').replace(/\n/g, '\\n');
  } else if (type === 'tool') {
    icon = '🔧';
    role = 'Tool';
    const raw = String((msg as any).content ?? '');
    content = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
  } else {
    icon = '❓';
    role = type;
    content = '';
  }

  const truncated =
    content.length > 100 ? content.slice(0, 100) + '…' : content;
  return `  ${String(idx).padEnd(3)} ${icon} ${role.padEnd(14)} ${truncated}`;
}

function getFilterReason(
  msg: BaseMessage,
  idx: number,
  ctx: DebugContext,
): string {
  const type = (msg as any)._getType?.() ?? '';
  const hasTc = !!(msg as any).tool_calls?.length;

  if (ctx.isSupervised) {
    if (type === 'tool') return '❌ DROP (tool noise)';
    if (type === 'ai' && !hasTc) return '❌ DROP (cross-agent AI text)';
    if (type === 'ai' && hasTc) return '❌ DROP (tool_calls noise)';
    if (type === 'human' && ctx.messageTopics && ctx.currentAgent) {
      const topic = ctx.messageTopics[idx];
      if (!topic) return '✅ KEEP (no topic tag, backward compat)';
      if (topic === 'supervised') {
        const hasTask = ctx.pendingTasks.some(
          (t) => t.agent === ctx.currentAgent,
        );
        return hasTask
          ? `✅ KEEP (supervised, has pending task)`
          : `❌ DROP (supervised, no pending task for ${ctx.currentAgent})`;
      }
      const expected = agentToTopic[ctx.currentAgent];
      return topic === expected
        ? `✅ KEEP (topic="${topic}" matches agent)`
        : `❌ DROP (topic="${topic}" ≠ expected="${expected}")`;
    }
    return '✅ KEEP (Human, no topic filter)';
  }

  // Single-agent mode
  if (type === 'tool') {
    return ctx.toolIndicesToKeep.has(idx)
      ? '✅ KEEP (last AI(tc) response, API requirement)'
      : '❌ DROP (consumed by subsequent AI(text))';
  }
  if (type === 'ai' && hasTc) {
    return idx === ctx.lastToolCallerIdx
      ? '✅ KEEP (last AI(tc), API requirement)'
      : '❌ DROP (consumed by subsequent AI(text))';
  }
  if (type === 'ai') return '✅ KEEP (natural language summary)';
  if (type === 'human') return '✅ KEEP (user intent)';
  return '✅ KEEP (other)';
}

function formatDebugLog(
  input: BaseMessage[],
  output: BaseMessage[],
  ctx: DebugContext,
): string {
  const mode = ctx.isSupervised ? 'Supervisor (Multi-Agent)' : 'Single-Agent';
  const lines: string[] = [];
  const sep = '─'.repeat(72);

  lines.push('');
  lines.push(`┌${sep}┐`);
  lines.push(`│  prepareAgentContext — Mode: ${mode}`);
  lines.push(
    `│  currentAgent=${ctx.currentAgent ?? '(none)'}  pendingTasks=${ctx.pendingTasks.length}`,
  );
  lines.push(`├${sep}┤`);
  lines.push(`│  ▼ INPUT (${input.length} messages)`);
  lines.push(`├${sep}┤`);

  for (let i = 0; i < input.length; i++) {
    lines.push(formatMsgPreview(input[i], i));
  }

  lines.push(`├${sep}┤`);
  lines.push(`│  ▼ FILTER DECISIONS`);
  lines.push(`├${sep}┤`);

  for (let i = 0; i < input.length; i++) {
    const decision = getFilterReason(input[i], i, ctx);
    lines.push(`${decision}`);
    lines.push(`  ${'─'.repeat(68)}`);
  }

  lines.push(`├${sep}┤`);
  lines.push(
    `│  ▼ OUTPUT (${output.length} messages)${output.length < input.length ? ` — removed ${input.length - output.length}` : ''}`,
  );
  lines.push(`├${sep}┤`);

  for (let i = 0; i < output.length; i++) {
    lines.push(formatMsgPreview(output[i], i));
  }

  lines.push(`└${sep}┘`);
  lines.push('');
  return lines.join('\n');
}

/**
 * 准备 Agent 上下文消息
 * 从全部消息中提取当前 Agent 可用的上下文（strip tool noise + 按 topic 隔离跨 Agent 消息）
 * @param messages state.messages 中的全部消息
 * @param pendingTasks 待处理的多 Agent 任务列表（非空 = supervisor 模式）
 * @param messageTopics 消息话题标记（可选），key=消息索引，value=intent
 * @param currentAgent 当前 Agent 名称（可选），如 'walletAgent'
 * @returns 过滤后的消息数组（不含 tool 和跨 Agent AI 纯文本）
 */
export function prepareAgentContext(
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
          return pendingTasks.some((t) => t.agent === currentAgent);
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

  // ================================================================
  // DEBUG: 打印上下文过滤明细（设置 DEBUG_AGENT_CONTEXT=true 启用）
  // ================================================================
  if (process.env.DEBUG_AGENT_CONTEXT) {
    debugLogger.log(
      formatDebugLog(messages, filtered, {
        isSupervised,
        lastToolCallerIdx,
        toolIndicesToKeep,
        currentAgent,
        messageTopics,
        pendingTasks,
      }),
    );
  }

  return filtered;
}
