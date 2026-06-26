import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '@api/common/ai/ai.service';
import { intentRouterNode } from '@api/client/ai-customer/graph/nodes/intent-router.node';
import { HumanMessage } from '@langchain/core/messages';
import { buildCustomerGraph } from '@api/client/ai-customer/graph/customer.graph';

@Injectable()
export class AiCustomerService {
  private readonly logger = new Logger(AiCustomerService.name);
  private compiledGraph: ReturnType<typeof buildCustomerGraph> | null = null;

  constructor(
    private readonly aiService: AiService,
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
      this.compiledGraph = buildCustomerGraph();
      this.logger.log('AiCustomer Graph compiled successfully');
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
   * @param input
   * @param userId
   * @param sessionId
   */
  async chatStream(input: string, userId: string, sessionId: string) {
    throw new Error(
      'Not implemented yet — will be implemented with SSE streaming in a later step',
    );
  }

  async testIntent(userMessage: string): Promise<{ intent: string }> {
    this.logger.log(`Testing intent classification: "${userMessage}"`);
    const result = await intentRouterNode({
      messages: [new HumanMessage(userMessage)],
      intent: '',
      agentSteps: [],
      agentOutput: '',
      sources: [],
      userId: '',
    });
    return { intent: result.intent ?? '' };
  }
}
