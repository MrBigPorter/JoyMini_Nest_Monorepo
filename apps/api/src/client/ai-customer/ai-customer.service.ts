import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { buildCustomerGraph } from '@api/client/ai-customer/graph/customer.graph';
import { ConfigService } from '@nestjs/config';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { EventsGateway } from '@api/common/events/events.gateway';
import { SocketEvents } from '@lucky/shared';
import { TestChatResult } from '@api/client/ai-customer/graph/types/agent-types';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';
import { MeilisearchService } from '@api/common/meilisearch/meilisearch.service';
import { AiMemoryService } from '@api/common/ai/ai-memory.service';

@Injectable()
export class AiCustomerService {
  private readonly logger = new Logger(AiCustomerService.name);
  private compiledGraph: ReturnType<typeof buildCustomerGraph> | null = null;
  private llmConfig: LlmProviderConfig | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly registry: ToolRegistryService,
    private readonly aiService: AiService,
    private readonly prismaService: PrismaService,
    private readonly ragRetrievalService: RagRetrievalService,
    private readonly promptResolver: PromptResolverService,
    private readonly meilisearchService: MeilisearchService,
    private readonly aiMemoryService: AiMemoryService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * 应用启动时初始化图谱
   * 1. 编译图谱，生成可执行的有向图
   * 2. 如果编译失败，抛出异常，阻止应用启动
   * 3. 如果编译成功，记录日志
   */
  async onModuleInit() {
    await this.initGraph();
  }

  /**
   * 初始化图谱
   * 1. 如果图谱已编译，直接返回
   * 2. 尝试编译图谱，如果失败，记录错误并抛出异常
   * 3. 如果成功，记录日志
   */
  async initGraph() {
    if (this.compiledGraph) return;
    try {
      this.llmConfig = {
        type: this.configService.get<'online' | 'local'>(
          'AI_LLM_TYPE',
          'local',
        ),
        model: this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:0.8b'),
        baseURL: this.configService.get<string>(
          'AI_OLLAMA_BASE_URL',
          'http://localhost:11434',
        ),
        apiKey: this.configService.get<string>('DEEPSEEK_API_KEY'),
      };
      this.compiledGraph = buildCustomerGraph(
        this.llmConfig,
        this.registry,
        this.aiService,
        this.prismaService,
        this.meilisearchService,
        this.ragRetrievalService,
        this.promptResolver,
      );
    } catch (error) {
      this.logger.error('Failed to compile AiCustomer Graph', error);
      throw error;
    }
  }

  /*
   * 获取已编译的图谱
   * 1. 如果图谱未初始化，抛出异常
   * 2. 返回已编译的图谱
   */
  getGraph() {
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initGraph() first.');
    }
    return this.compiledGraph;
  }

  /**
   * 流式聊天接口
   * 1. 接收用户消息、用户 ID、会话 ID 和回调函数
   * 2. 调用图谱的 streamEvents 方法，获取事件流
   * 3. 根据事件类型调用相应的回调函数，将数据推送给前端
   * 4. 如果发生错误，调用 onError 回调
   * 5. 流结束时，调用 onDone 回调
   * @param message
   * @param userId
   * @param sessionId
   * @param callbacks
   * @returns
   */
  async chatStream(
    message: string,
    userId: string,
    sessionId: string,
    callbacks: {
      onToken: (token: string) => void;
      onStep: (step: string, data?: any) => void;
      onDone: () => void;
      onError: (error: Error) => void;
      onTransfer?: (reason: string) => void;
    },
    conversationId?: string,
    entryPoint?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    // 边界检查
    if (!this.compiledGraph) {
      callbacks.onError(new Error('Graph not initialized'));
      return;
    }
    if (!message || !userId) {
      callbacks.onError(new Error('Message and userId are required'));
      return;
    }

    this.logger.log(`[chatStream] message="${message.slice(0, 50)}..."`);

    try {
      // 获取或创建 AI 对话（支持传入已有 SUPPORT 对话 ID）
      const conversation =
        await this.aiMemoryService.createOrGetAiConversation(userId, conversationId);
      const threadId = conversation.threadId!;

      // 流开始前：记下已有消息数，流结束后只取增量
      const prevState = await this.compiledGraph.getState({
        configurable: { thread_id: threadId },
      });
      const prevCount = prevState?.values?.messages?.length ?? 0;

      // ── streamEvents: LangGraph 事件流 ──
      // streamEvents 是 graph.invoke() 的流式替代方案。
      //
      // invoke(): 等全部跑完 → 一次性返回结果（阻塞 2-5 秒）
      // streamEvents(): 每步都发出事件 → 实时推送（首字 200ms）
      //
      // 事件流像一条传送带，上面有各种类型的事件包裹（eventName）：
      //   on_chat_model_stream = LLM 正在生成文字（逐 token）
      //   on_tool_start       = Agent 开始调工具（如查余额）
      //   on_tool_end         = Agent 调完工具
      //
      // 我们用 for await 循环从传送带上逐个取包裹拆开看，
      // 通过 callbacks 推给 Controller，Controller 再通过 SSE 推给浏览器。
      // ────────────────────────────────────────────────────────────
      callbacks.onStep('thinking', { content: 'analyzing your question...' });

      const eventStream = await this.compiledGraph.streamEvents(
        {
          messages: [new HumanMessage(message)],
          userId,
          debug: false,
          entryPoint: entryPoint ?? '',
          entryMetadata: metadata ?? {},
        },
        {
          version: 'v2',
          configurable: { thread_id: threadId },
        },
      );

      this.logger.log(
        `[chatStream] event stream started for eventStream=${eventStream}`,
      );

      // 循环遍历事件流中的每个事件
      for await (const event of eventStream) {
        const { event: eventName, data, name, metadata } = event;

        // 1. LLM 正在生成回复 → 把当前 token 推给前端（打字机效果）
        //    注意：streamEvents 会捕获图中所有 LLM 调用，包括 intentRouter 的 LLM fallback。
        //    我们需要跳过非 orchestrator 节点的 LLM 输出，避免意图分类的 JSON 泄漏到回复中。
        if (eventName === 'on_chat_model_stream') {
          const node = metadata?.langgraph_node as string | undefined;
          // 意图分类阶段（intentGateway / intentRouter）的 LLM 输出是内部 JSON，不推给用户
          if (node === 'intentGateway' || node === 'intentRouter') continue;
          const chunk = data?.chunk;
          if (chunk?.content) {
            callbacks.onToken(chunk.content);
            // Socket 推送：AI 逐字 token（给 Flutter App）
            if (conversationId) {
              this.eventsGateway.dispatch(conversationId, SocketEvents.AI_TOKEN, { content: chunk.content });
            }
          }
        }
        // 2. Agent 开始调工具 → 通知前端显示"正在查余额..."
        else if (eventName === 'on_tool_start') {
          const displayName = this.registry.getDisplayName(name) ?? name;
          callbacks.onStep('tool_start', { tool: displayName });
          // Socket 推送：AI 处理步骤
          if (conversationId) {
            this.eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, { step: 'tool_start', tool: displayName });
          }
        }
        // 3. Agent 调完工具 → 通知前端"查完了"
        else if (eventName === 'on_tool_end') {
          callbacks.onStep('tool_end', { tool: name });
          if (conversationId) {
            this.eventsGateway.dispatch(conversationId, SocketEvents.AI_STEP, { step: 'tool_end', tool: name });
          }
        }
      }
      // streamEvents 把所有消息追加到了 MemorySaver
      // 现在用 getState 读最终状态
      const finalState = await this.compiledGraph.getState({
        configurable: { thread_id: threadId },
      });
      const allMessages = finalState?.values?.messages ?? [];

      // 只取本轮新增的（跳过已有消息）
      const newMessages = allMessages.slice(prevCount);

      // 保存本轮对话到数据库
      if (newMessages.length > 0) {
        await this.aiMemoryService.saveContext(threadId, newMessages);
      }

      // 检查是否需要转人工
      if (finalState?.values?.transferToHuman && callbacks.onTransfer) {
        callbacks.onTransfer('ai_determined');
        if (conversationId) {
          this.eventsGateway.dispatch(conversationId, SocketEvents.AI_TRANSFER, { conversationId, reason: 'ai_determined' });
        }
      } else {
        callbacks.onDone();
        if (conversationId) {
          this.eventsGateway.dispatch(conversationId, SocketEvents.AI_DONE, { conversationId });
        }
      }
    } catch (err: any) {
      this.logger.error(`[chatStream] error: ${err.message}`);
      callbacks.onError(err);
      if (conversationId) {
        this.eventsGateway.dispatch(conversationId, SocketEvents.AI_ERROR, { content: err.message });
      }
    }
  }

  async testChat(
    message: string,
    userId: string,
    debug = false,
    sessionId?: string,
  ) {
    this.logger.log(`Testing chat classification: "${message}"`);
    if (!this.compiledGraph) {
      throw new Error('Graph not initialized. Call initGraph() first.');
    }

    const threadId = sessionId ?? `${userId}:${Date.now()}`;

    const result = await this.compiledGraph.invoke(
      {
        messages: [new HumanMessage(message)],
        userId: userId,
        debug,
      },
      {
        configurable: {
          thread_id: threadId,
        },
      },
    );

    // 从 messages 中取最后一条消息作为最终输出
    const allMessages = result.messages ?? [];
    const lastMsg = allMessages[allMessages.length - 1];
    const agentOutput =
      typeof lastMsg?.content === 'string' ? lastMsg.content : '';

    this.logger.log(
      `[testChat] result: intent="${result.intent}", labels=${JSON.stringify(result.labels ?? [])}, previousIntent="${result.previousIntent ?? ''}"`,
    );

    // debug=true 时返回完整流水线追踪数据
    const response: TestChatResult = {
      intent: result.intent ?? '',
      agentOutput,
    };
    if (debug) {
      response.debug = result.debugInfo ?? undefined;
    }

    return response;
  }
}
