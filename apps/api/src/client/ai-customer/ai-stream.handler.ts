import { HumanMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { SocketEvents } from '@lucky/shared';
import { EventsGateway } from '@api/common/events/events.gateway';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { emitStage } from '@api/common/logger/structured-logger';
import { runWithContext } from '@api/common/logger/trace-context';
import { incCounter } from '@api/common/metrics/metrics';
import { redactPiiText } from '@api/common/utils/pii-redaction';
import type { ActionContext } from '@api/client/ai-customer/action-context';

const logger = new Logger('AiStreamHandler');

export interface StreamHandlerCallbacks {
  onToken: (token: string) => void;
  onStep: (step: string, data?: any) => void;
}

/** 一次工具调用的落库摘要（用于 ai_spans type=tool）。 */
export interface ToolSpanSummary {
  name: string;
  status: 'OK' | 'ERROR';
  durationMs: number;
  /** 已脱敏、截断的参数摘要；绝不含完整手机号/邮箱/证件号。 */
  argsSummary: string | null;
  startedAt: number;
}

/** 一次对话的总 token 用量，回传给 chat.done 记 tokenTotal */
export interface StreamUsageSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** 本轮工具调用摘要，供 recordReplyTrace 写成 type=tool 的 span */
  toolSpans?: ToolSpanSummary[];
}

/** 工具输出是否表示失败：兼容 ToolResult JSON 字符串、Error: 文本与对象。 */
function toolOutputStatus(output: unknown): 'OK' | 'ERROR' {
  if (typeof output === 'string') {
    if (output.startsWith('Error:') || /"ok"\s*:\s*false/.test(output)) {
      return 'ERROR';
    }
    return 'OK';
  }
  if (output && typeof output === 'object') {
    if ((output as any).ok === false) return 'ERROR';
    const content = (output as any).content;
    if (typeof content === 'string') return toolOutputStatus(content);
  }
  return 'OK';
}

/** 序列化工具参数并脱敏；循环引用等异常降级为 null。 */
function summarizeToolArgs(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  try {
    const raw = JSON.stringify(input);
    const safe = redactPiiText(raw);
    if (!safe) return null;
    return safe.length > 300 ? `${safe.slice(0, 300)}…` : safe;
  } catch {
    return null;
  }
}

/**
 * 执行 LangGraph 事件流，逐事件推给前端
 * 独立抽出，避免事件处理逻辑混在主流程里
 *
 * ── 身份边界（重要）──
 * 进入 Agent 运行时前，把当前登录用户写进 AsyncLocalStorage。
 * 工具是启动时注册的全局单例，只能通过请求上下文知道"这次属于谁"；
 * 不能从模型参数拿 userId，也不能在启动时绑定固定用户。
 */
export async function handleEventStream(
  compiledGraph: any,
  threadId: string,
  message: string,
  userId: string,
  conversationId: string | undefined,
  entryPoint: string | undefined,
  metadata: Record<string, any> | undefined,
  registry: ToolRegistryService,
  eventsGateway: EventsGateway,
  callbacks: StreamHandlerCallbacks,
  /**
   * 会话成员 userId 列表，由调用方每轮查一次后传进来。
   * 用途：给 `user_X` 私有房间兜底推送（客户端重连不重放 join_chat 时仍能收到，见 #87 N-9）。
   * 不在这里查库，是因为这里每收到一个 token 都会调用，查库会把 DB 打爆。
   */
  memberUserIds: string[] = [],
  /**
   * 显式取消信号（可选）。作为 RunnableConfig.signal 传给 LangGraph：
   * Pregel 会把它并入每个节点的 config，底层 ChatOpenAI 再把它交给
   * OpenAI SDK 的 request options（见 @langchain/openai completions.js）。
   * 即使 provider 不响应，下面的循环也会在每次迭代检查并停止消费事件。
   *
   * 当前 Socket 生产链路尚未接入。注意：客户端断线不等于应取消——
   * AI 回复会落库并通过用户私有房间补推，继续生成可能是正确的。
   */
  signal?: AbortSignal,
  /**
   * 本轮注入的用户长期记忆（已格式化为 system 文本）。
   * 只作为数据传入，不写入 messages，避免污染对话与放大隐私数据。
   */
  userMemory = '',
  /**
   * 本轮从 DB 读取的最近一次写操作状态。只作为数据传入，不写进 messages。
   */
  actionContext: ActionContext | null = null,
): Promise<StreamUsageSummary> {
  return runWithContext({ userId }, async () => {
    const config: Record<string, any> = {
      version: 'v2',
      configurable: { thread_id: threadId },
    };
    // 只有真的有 signal 时才放进 config，保持老调用方行为不变
    if (signal) config.signal = signal;

    const eventStream = await compiledGraph.streamEvents(
      {
        messages: [new HumanMessage(message)],
        userId,
        conversationId: conversationId ?? '',
        debug: false,
        entryPoint: entryPoint ?? '',
        entryMetadata: metadata ?? {},
        userMemory,
        actionContext,
      },
      config,
    );

    // 用 run_id 记"开始时间"，等待对应的 end 事件到达后再相减得出耗时。
    // 比在每层手动传计时器干净：LangGraph 的 start/end 事件天然成对。
    const modelStartedAt = new Map<string, number>();
    const toolStartedAt = new Map<string, number>();
    const toolArgsSummary = new Map<string, string | null>();
    const toolSpans: ToolSpanSummary[] = [];
    let totalTokens = 0;
    let promptTokensTotal = 0;
    let completionTokensTotal = 0;

    for await (const event of eventStream) {
      // 兜底：provider/图没响应 signal 时，至少不再消费事件、不再推 token
      if (signal?.aborted) {
        logger.log(
          `[stream] abort observed in handler loop, stop consuming events (thread=${threadId})`,
        );
        break;
      }
      const { event: eventName, data, name, metadata: meta, run_id } = event;
      const node = meta?.langgraph_node as string | undefined;

      if (eventName === 'on_chat_model_stream') {
        // LLM 逐 token 输出 → 打字机效果
        if (node === 'intentGateway' || node === 'intentRouter') continue;
        const chunk = data?.chunk;
        if (chunk?.content) {
          callbacks.onToken(chunk.content);
          if (conversationId) {
            eventsGateway.dispatchToConversation(
              conversationId,
              memberUserIds,
              SocketEvents.AI_TOKEN,
              { content: chunk.content },
            );
          }
        }
      } else if (eventName === 'on_chat_model_start') {
        modelStartedAt.set(run_id, Date.now());
      } else if (eventName === 'on_chat_model_end') {
        // usage 来自 provider 的最后一条 chunk（依赖 streamUsage: true）
        const usage = (data?.output as any)?.usage_metadata;
        const promptTokens = usage?.input_tokens ?? 0;
        const completionTokens = usage?.output_tokens ?? 0;
        const eventTokens =
          usage?.total_tokens ?? promptTokens + completionTokens;
        totalTokens += eventTokens;
        promptTokensTotal += promptTokens;
        completionTokensTotal += completionTokens;

        incCounter('ai_llm_tokens_total', { type: 'prompt' }, promptTokens);
        incCounter(
          'ai_llm_tokens_total',
          { type: 'completion' },
          completionTokens,
        );
        incCounter('ai_llm_tokens_total', { type: 'total' }, eventTokens);

        const startAt = modelStartedAt.get(run_id);
        modelStartedAt.delete(run_id);

        emitStage('llm.usage', {
          model:
            meta?.ls_model_name ??
            (data?.output as any)?.response_metadata?.model_name,
          node: node ?? 'unknown',
          promptTokens,
          completionTokens,
          totalTokens: eventTokens,
          // provider 没带 usage（如本地 Ollama）时显式标注，便于区分"0"和"没数据"
          usageSource: usage ? 'provider' : 'unavailable',
          latencyMs: startAt ? Date.now() - startAt : undefined,
        });
      } else if (eventName === 'on_tool_start') {
        // Agent 开始调工具
        toolStartedAt.set(run_id, Date.now());
        toolArgsSummary.set(run_id, summarizeToolArgs(data?.input));
        incCounter('ai_tool_calls_total', { tool: name });
        emitStage('tool.start', { tool: name, node });
        const displayName = registry.getDisplayName(name) ?? name;
        callbacks.onStep('tool_start', { tool: displayName });
        if (conversationId) {
          eventsGateway.dispatchToConversation(
            conversationId,
            memberUserIds,
            SocketEvents.AI_STEP,
            {
              step: 'tool_start',
              tool: displayName,
            },
          );
        }
      } else if (eventName === 'on_tool_end') {
        // Agent 调完工具
        const startAt = toolStartedAt.get(run_id);
        toolStartedAt.delete(run_id);
        const startedAt = startAt ?? Date.now();
        const durationMs = startAt ? Date.now() - startAt : 0;
        toolSpans.push({
          name,
          status: toolOutputStatus(data?.output),
          durationMs,
          argsSummary: toolArgsSummary.get(run_id) ?? null,
          startedAt,
        });
        toolArgsSummary.delete(run_id);
        emitStage('tool.end', {
          tool: name,
          node,
          durationMs: startAt ? durationMs : undefined,
        });
        callbacks.onStep('tool_end', { tool: name });
        if (conversationId) {
          eventsGateway.dispatchToConversation(
            conversationId,
            memberUserIds,
            SocketEvents.AI_STEP,
            { step: 'tool_end', tool: name },
          );
        }
      }
    }

    return {
      totalTokens,
      promptTokens: promptTokensTotal,
      completionTokens: completionTokensTotal,
      toolSpans,
    };
  });
}
