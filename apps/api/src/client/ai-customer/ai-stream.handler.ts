import { HumanMessage } from '@langchain/core/messages';
import { SocketEvents } from '@lucky/shared';
import { EventsGateway } from '@api/common/events/events.gateway';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';

export interface StreamHandlerCallbacks {
  onToken: (token: string) => void;
  onStep: (step: string, data?: any) => void;
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
): Promise<void> {
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

  for await (const event of eventStream) {
    const { event: eventName, data, name, metadata: meta } = event;

    if (eventName === 'on_chat_model_stream') {
      // LLM 逐 token 输出 → 打字机效果
      const node = meta?.langgraph_node as string | undefined;
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
    } else if (eventName === 'on_tool_start') {
      // Agent 开始调工具
      const displayName = registry.getDisplayName(name) ?? name;
      callbacks.onStep('tool_start', { tool: displayName });
      if (conversationId) {
        eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, {
          step: 'tool_start', tool: displayName,
        });
      }
    } else if (eventName === 'on_tool_end') {
      // Agent 调完工具
      callbacks.onStep('tool_end', { tool: name });
      if (conversationId) {
        eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, {
          step: 'tool_end', tool: name,
        });
      }
    }
  }
}
