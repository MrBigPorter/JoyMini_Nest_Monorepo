import { HumanMessage } from '@langchain/core/messages';
import { SocketEvents } from '@lucky/shared';
import { EventsGateway } from '@api/common/events/events.gateway';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { emitStage } from '@api/common/logger/structured-logger';

export interface StreamHandlerCallbacks {
  onToken: (token: string) => void;
  onStep: (step: string, data?: any) => void;
}

/** 一次对话的总 token 用量，回传给 chat.done 记 tokenTotal */
export interface StreamUsageSummary {
  totalTokens: number;
}

/**
 * 执行 LangGraph 事件流，逐事件推给前端
 * 独立抽出，避免事件处理逻辑混在主流程里
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
): Promise<StreamUsageSummary> {
  const eventStream = await compiledGraph.streamEvents(
    {
      messages: [new HumanMessage(message)],
      userId,
      debug: false,
      entryPoint: entryPoint ?? '',
      entryMetadata: metadata ?? {},
    },
    { version: 'v2', configurable: { thread_id: threadId } },
  );

  // 用 run_id 记"开始时间"，等待对应的 end 事件到达后再相减得出耗时。
  // 比在每层手动传计时器干净：LangGraph 的 start/end 事件天然成对。
  const modelStartedAt = new Map<string, number>();
  const toolStartedAt = new Map<string, number>();
  let totalTokens = 0;

  for await (const event of eventStream) {
    const { event: eventName, data, name, metadata: meta, run_id } = event;
    const node = meta?.langgraph_node as string | undefined;

    if (eventName === 'on_chat_model_stream') {
      // LLM 逐 token 输出 → 打字机效果
      if (node === 'intentGateway' || node === 'intentRouter') continue;
      const chunk = data?.chunk;
      if (chunk?.content) {
        callbacks.onToken(chunk.content);
        if (conversationId) {
          eventsGateway.dispatch(conversationId, SocketEvents.AI_TOKEN, {
            content: chunk.content,
          });
        }
      }
    } else if (eventName === 'on_chat_model_start') {
      modelStartedAt.set(run_id, Date.now());
    } else if (eventName === 'on_chat_model_end') {
      // usage 来自 provider 的最后一条 chunk（依赖 streamUsage: true）
      const usage = (data?.output as any)?.usage_metadata;
      const promptTokens = usage?.input_tokens ?? 0;
      const completionTokens = usage?.output_tokens ?? 0;
      const eventTokens = usage?.total_tokens ?? promptTokens + completionTokens;
      totalTokens += eventTokens;

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
      emitStage('tool.start', { tool: name, node });
      const displayName = registry.getDisplayName(name) ?? name;
      callbacks.onStep('tool_start', { tool: displayName });
      if (conversationId) {
        eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, {
          step: 'tool_start', tool: displayName,
        });
      }
    } else if (eventName === 'on_tool_end') {
      // Agent 调完工具
      const startAt = toolStartedAt.get(run_id);
      toolStartedAt.delete(run_id);
      emitStage('tool.end', {
        tool: name,
        node,
        durationMs: startAt ? Date.now() - startAt : undefined,
      });
      callbacks.onStep('tool_end', { tool: name });
      if (conversationId) {
        eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, {
          step: 'tool_end', tool: name,
        });
      }
    }
  }

  return { totalTokens };
}
