import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { buildCustomerGraph } from '@api/client/ai-customer/graph/customer.graph';
import { ConfigService } from '@nestjs/config';
import { LlmProviderConfig } from '@api/client/ai-customer/graph/llm-factory';
import { ToolRegistryService } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { TestChatResult } from '@api/client/ai-customer/graph/types/agent-types';
import { AiService } from '@api/common/ai/ai.service';
import { PrismaService } from '@api/common/prisma/prisma.service';
import { RagRetrievalService } from '@api/client/ai-customer/knowledge/rag-retrieval.service';
import { PromptResolverService } from '@api/client/ai-customer/knowledge/prompt-resolver.service';

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
    },
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
      const threadId = sessionId ?? `${userId}:${Date.now()}`;

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
        const { event: eventName, data, name } = event;

        // 1. LLM 正在生成回复 → 把当前 token 推给前端（打字机效果）
        if (eventName === 'on_chat_model_stream') {
          const chunk = data?.chunk;
          if (chunk?.content) {
            callbacks.onToken(chunk.content);
          }
        }
        // 2. Agent 开始调工具 → 通知前端显示"正在查余额..."
        else if (eventName === 'on_tool_start') {
          callbacks.onStep('tool_start', { tool: name });
        }
        // 3. Agent 调完工具 → 通知前端"查完了"
        else if (eventName === 'on_tool_end') {
          callbacks.onStep('tool_end', { tool: name });
        }
      }

      callbacks.onDone();
    } catch (err: any) {
      this.logger.error(`[chatStream] error: ${err.message}`);
      callbacks.onError(err);
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
