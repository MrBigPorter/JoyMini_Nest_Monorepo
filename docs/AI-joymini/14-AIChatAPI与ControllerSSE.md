# 14. AI Chat API + Controller + SSE Streaming

## 🎯 本步骤目标

实现 AI 客服的 HTTP API 端点，使用 **Server-Sent Events (SSE)** 协议将 LangGraph 的执行结果以流式方式推送给前端。这是整个 AI 客服系统的**对外接口层**。

---

## 📖 背景说明

### 承上

在 [**13-PrismaKnowledge模型与pgvector**](13-PrismaKnowledge模型与pgvector.md) 中，我们完成了：
- Prisma `KnowledgeDocument` / `KnowledgeEmbedding` 模型定义
- `KnowledgeSyncService` 同步服务（文件 → DB → 向量）
- 脚本 `scripts/sync-knowledge.ts`

现在 Phase 3（知识库）的存储层已经定义好，可以回到 **Phase 4（前端 UI）**，从最外层的 **API 端点**开始串联整个链路。

### 这一步要解决的问题

1. **SSE vs WebSocket** — AI 客服是典型的"一问一答"模式，SSE 单向流足够，且实现简单、兼容性好
2. **LangGraph 执行是异步的** — `graph.invoke()` 返回 Promise，但我们需要**逐 token 流式**输出给前端
3. **Agent 中间步骤可见** — 用户想知道 AI 在做什么（查订单？查钱包？），需要把 agent 的 `tool_calls` 和 `tool_results` 也推送给前端
4. **NestJS 原生 SSE** — NestJS 的 `@Res()` 装饰器可以直接操作 `Response` 对象，不依赖额外库

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 通信协议 | SSE / WebSocket | **SSE** | 一问一答模式，SSE 实现简单；前端 `EventSource` / `fetchEventSource` 原生支持 |
| 流式方式 | `streamEvents()` / `stream()` / `invoke()` | **`streamEvents()`** | LangGraph v0.2+ 推荐 API，可以区分事件类型（on_chat_model_stream / on_tool_start 等） |
| 消息格式 | JSON Lines / SSE data | **SSE data** | 标准 SSE 协议，`data: {...}\n\n` 格式，前端 `JSON.parse` 即可 |
| 事件类型 | 4 种 / 更多 | **4 种：`token` / `step` / `done` / `error`** | 简洁明确，前端容易消费 |
| Controller 路由 | `POST /ai-customer/chat/stream` | **POST** | 虽然 SSE 惯例用 GET，但我们需要在 body 中传递消息，POST 更合理 |

---

## ⚙️ 前置条件

### 环境要求

- NestJS v11+（项目已有）
- `@langchain/langgraph` v0.2+（已在 [02](02-安装LangGraph依赖与修复ModuleExports.md) 中安装）
- `@nestjs/common` 的 `@Res()` 装饰器可用（自带）

### 文件/配置准备

- [`ai-customer.controller.ts`](03-创建AiCustomerModule与GraphState.md) 骨架已创建（Step 4）
- [`ai-customer.service.ts`](05-AnswerSynthesizer与Graph组装.md) 中 `initGraph()` + `buildCustomerGraph()` 已实现
- [`graph/customer.graph.ts`](05-AnswerSynthesizer与Graph组装.md) 已实现所有 11 个节点

### 知识准备

- **SSE 协议基础**：`text/event-stream`、`data:` 字段、`\n\n` 分隔
- **LangGraph `streamEvents()` API**：LangGraph v0.2.3+ 支持的事件流 API
- **NestJS `@Res()`**：注入原生 Express/Fastify Response 对象

---

## 📝 实现步骤

### Step 1: 实现 `AiCustomerService.chatStream()` 方法

这一步是核心：用 `graph.streamEvents()` 替代 `graph.invoke()`，并将事件转换为统一的 SSE 事件格式。

**文件**：[`apps/api/src/client/ai-customer/ai-customer.service.ts`](apps/api/src/client/ai-customer/ai-customer.service.ts)

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { ServiceProvider } from './graph/service-provider'; // 见下文说明

@Injectable()
export class AiCustomerService implements OnModuleInit {
  private readonly logger = new Logger(AiCustomerService.name);
  private graph: CompiledStateGraph<any, any>;
  // ... 所有 Service 注入（已在 03 中定义）...

  async onModuleInit() {
    this.initGraph();
  }

  // chatStream: 使用 streamEvents 逐事件推送
  async chatStream(
    userId: string,
    message: string,
    onEvent: (type: string, data: any) => void,
    onError: (error: Error) => void,
    onDone: () => void,
  ): Promise<void> {
    try {
      // 1. 构建初始状态
      const initialState = {
        messages: [
          new HumanMessage(
            `[当前用户ID: ${userId}]\n${message}`
          ),
        ],
        intent: null,
        agentOutput: null,
        userId,
      };

      // 2. 调用 streamEvents — 返回 AsyncIterable
      const eventStream = await this.graph.streamEvents(initialState, {
        version: 'v2',
      });

      // 3. 遍历事件流
      for await (const event of eventStream) {
        const { event: eventName, data } = event;

        switch (eventName) {
          // ── LLM 输出（逐 token） ──
          case 'on_chat_model_stream': {
            const chunk = data?.chunk;
            if (chunk?.content) {
              onEvent('token', { content: chunk.content });
            }
            break;
          }

          // ── Tool 开始执行 ──
          case 'on_tool_start': {
            onEvent('step', {
              type: 'tool_start',
              tool: data?.name,
              input: data?.input,
            });
            break;
          }

          // ── Tool 执行完成 ──
          case 'on_tool_end': {
            onEvent('step', {
              type: 'tool_end',
              tool: data?.name,
              output: data?.output,
            });
            break;
          }

          default:
            break;
        }
      }

      // 4. 流结束
      onDone();
    } catch (err) {
      this.logger.error(`chatStream error: ${err.message}`, err.stack);
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
```

> **关于 `ServiceProvider`**：这是可选的设计模式。如果 Agent Node 需要访问 Service，可以通过两种方式：
> 1. **闭包工厂模式**（文档 06-11 采用的方式）：`createOrderAgentNode(orderService)` 在构建时注入
> 2. **ServiceProvider 类**：在模块中注册为 Provider，Agent Node 通过构造器注入
>
> 我们推荐继续使用 **工厂函数模式**（已在文档 06 中确立），这里 `chatStream` 不需要关心 Service 注入细节。

#### 关键设计说明

**为什么用 `streamEvents` 而不是 `invoke`？**

| 方法 | 特点 | 适用场景 |
|---|---|---|
| `invoke()` | 返回最终结果，等待全部完成 | 非流式请求 |
| `stream()` | 流式输出 `messages` 列表 | 简单逐消息流 |
| **`streamEvents()`** | 流式输出**所有事件**（LLM token、Tool 调用等） | **AI 客服（需要中间步骤可见）** |

**为什么事件版本用 `v2`？**

LangGraph v0.2+ 将事件格式从 `{event, name, data}` 统一为 `{event: string, data: any}` 格式。`version: 'v2'` 确保使用最新的稳定事件格式。

### Step 2: 实现 Controller SSE 端点

**文件**：[`apps/api/src/client/ai-customer/ai-customer.controller.ts`](apps/api/src/client/ai-customer/ai-customer.controller.ts)

```typescript
import {
  Controller, Post, Body, Res, UseGuards, Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { AiCustomerService } from './ai-customer.service';

@Controller('ai-customer')
@UseGuards(JwtAuthGuard)
export class AiCustomerController {
  private readonly logger = new Logger(AiCustomerController.name);

  constructor(
    private readonly aiCustomerService: AiCustomerService,
  ) {}

  @Post('chat/stream')
  async chatStream(
    @CurrentUserId() userId: string,
    @Body('message') message: string,
    @Res() res: Response,
  ): Promise<void> {
    // ── 参数校验 ──
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required and must be a string' });
      return;
    }

    // ── 设置 SSE 响应头 ──
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');   // 禁用 Nginx 缓冲
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();                           // 立即发送头部

    // ── 辅助函数：发送 SSE 事件 ──
    const sendSSE = (type: string, data: any) => {
      try {
        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      } catch (e) {
        // 客户端断开连接时忽略写入错误
      }
    };

    try {
      await this.aiCustomerService.chatStream(
        userId,
        message,
        // onEvent
        (type, data) => sendSSE(type, data),
        // onError
        (error) => {
          sendSSE('error', { content: error.message || '处理请求时出错' });
          res.end();
        },
        // onDone
        () => {
          sendSSE('done', {});
          res.end();
        },
      );
    } catch (err) {
      this.logger.error(`chatStream controller error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      } else {
        sendSSE('error', { content: '服务器内部错误' });
        res.end();
      }
    }
  }
}
```

#### SSE 事件格式定义

| 事件类型 `type` | 数据字段 | 说明 | 前端使用 |
|---|---|---|---|
| `token` | `{ content: string }` | LLM 输出的文本片段 | 逐 token 追加到对话气泡 |
| `step` | `{ type: 'tool_start' \| 'tool_end', tool: string, input?: any, output?: any }` | Agent 推理步骤 | 展示"思考中..."动画或步骤详情 |
| `done` | `{}` | 流结束 | 关闭 loading 状态、启用输入框 |
| `error` | `{ content: string }` | 错误信息 | 显示错误提示、重试按钮 |

#### 响应头说明

| 响应头 | 值 | 作用 |
|---|---|---|
| `Content-Type` | `text/event-stream; charset=utf-8` | 告诉浏览器这是 SSE 流 |
| `Cache-Control` | `no-cache` | 禁止缓存，保证实时性 |
| `Connection` | `keep-alive` | 保持长连接 |
| `X-Accel-Buffering` | `no` | **关键**：禁用 Nginx 缓冲，否则 SSE 会被缓存导致延迟 |
| `X-Content-Type-Options` | `nosniff` | 安全头，防止 MIME 嗅探 |

### Step 3: 处理客户端断开连接

如果用户在 AI 回复过程中关闭页面或取消请求，我们需要及时释放资源。

**方案**：监听 `res.on('close')` 事件，清理 LangGraph 执行。

在 Controller 方法中添加：

```typescript
let isCancelled = false;

res.on('close', () => {
  isCancelled = true;
  // 可以在这里终止 Agent 执行（需要 LangGraph 支持 interrupt）
  this.logger.log(`Client disconnected for user ${userId}`);
});

// 在 sendSSE 中检查
const sendSSE = (type: string, data: any) => {
  if (isCancelled) return;
  try {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  } catch (e) {
    // ignore
  }
};
```

> **注意**：LangGraph `streamEvents` 目前不支持中断正在执行的 ReAct 循环。客户端断开时，后端 Agent 仍会继续执行直到完成（只是不再发送数据）。这是已知的异步限制，后续可以通过 AbortController 或 `cancel` API 改进。

### Step 4: 添加非流式 Fallback 端点（可选）

有些场景需要非流式响应（如前端需要等待完整结果后再处理）。添加一个简单的 `invoke` 端点：

```typescript
@Post('chat')
@HttpCode(HttpStatus.OK)
async chat(
  @CurrentUserId() userId: string,
  @Body('message') message: string,
): Promise<{ answer: string }> {
  if (!message || typeof message !== 'string') {
    throw new BadRequestException('message is required');
  }

  const result = await this.aiCustomerService.chatNonStream(userId, message);
  return { answer: result };
}
```

对应的 `AiCustomerService` 方法：

```typescript
async chatNonStream(userId: string, message: string): Promise<string> {
  const initialState = {
    messages: [new HumanMessage(`[当前用户ID: ${userId}]\n${message}`)],
    intent: null,
    agentOutput: null,
    userId,
  };

  const finalState = await this.graph.invoke(initialState);
  return finalState.agentOutput || '抱歉，我暂时无法回答这个问题。';
}
```

### Step 5: 添加 Swagger 装饰器（可选）

为了让 API 在 Swagger 文档中显示，可以添加 `@ApiTags`、`@ApiOperation` 等装饰器：

```typescript
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('AI Customer Service')
@ApiBearerAuth()
@Controller('ai-customer')
@UseGuards(JwtAuthGuard)
export class AiCustomerController {
  @ApiOperation({ summary: 'AI 客服对话（SSE 流式）' })
  @Post('chat/stream')
  // ...
}
```

---

## ✅ 验收方式

### 手动验证

```bash
# 1. 获取 JWT Token（从已有登录接口获取）
TOKEN="your-jwt-token-here"

# 2. 测试 SSE 流式对话
curl -N -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "我想查一下最近的订单"}'
```

### 预期结果

```bash
# SSE 事件流输出示例（逐行推送）：

# ── Agent 开始推理 ──
data: {"type":"step","type":"tool_start","tool":"order_list","input":{"status":"all","page":1,"pageSize":5}}

# ── Agent 完成查询 ──
data: {"type":"step","type":"tool_end","tool":"order_list","output":"..."}

# ── LLM 生成回复（逐 token） ──
data: {"type":"token","content":"亲"}
data: {"type":"token","content":"，"}
data: {"type":"token","content":"您"}
data: {"type":"token","content":"最近"}
data: {"type":"token","content":"的"}
data: {"type":"token","content":"订单"}
data: {"type":"token","content":"情况"}
data: {"type":"token","content":"如下"}
data: {"type":"token","content":"："}
data: {"type":"token","content":"..."}

# ── 流结束 ──
data: {"type":"done",{}}
```

### 异常验证

```bash
# 1. 缺少 message 参数 → 400
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期: 400 {"error":"message is required and must be a string"}

# 2. 未授权 → 401
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "hello"}'
# 预期: 401 Unauthorized
```

### 单元测试验证

```typescript
// ai-customer.controller.spec.ts
describe('AiCustomerController', () => {
  let controller: AiCustomerController;
  let service: AiCustomerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AiCustomerController],
      providers: [
        {
          provide: AiCustomerService,
          useValue: {
            chatStream: jest.fn(),
            chatNonStream: jest.fn().mockResolvedValue('test answer'),
          },
        },
      ],
    }).compile();

    controller = module.get(AiCustomerController);
    service = module.get(AiCustomerService);
  });

  it('should reject empty message', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.chatStream('user1', '', res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should call chatStream with valid params', async () => {
    const res = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    };
    await controller.chatStream('user1', 'hello', res as any);
    expect(service.chatStream).toHaveBeenCalledWith(
      'user1', 'hello', expect.any(Function), expect.any(Function), expect.any(Function),
    );
  });
});
```

---

## 🔗 与 Frontend 的对接约定

后端 SSE 协议承诺以下 4 种事件，前端需要按此解析：

```typescript
// 前端 SSE 事件解析示例（TypeScript）
type SseEvent =
  | { type: 'token'; content: string }
  | { type: 'step'; type: 'tool_start' | 'tool_end'; tool: string; input?: any; output?: any }
  | { type: 'done' }
  | { type: 'error'; content: string };
```

前端可使用以下技术消费 SSE：

| 技术 | 适用场景 | 说明 |
|---|---|---|
| [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) | 浏览器原生 | 仅支持 GET 请求，不支持 POST → ❌ 不适用 |
| [`fetchEventSource`](https://github.com/Azure/fetch-event-source) | React 应用 | 支持 POST、自定义 headers、自动重连 → ✅ **推荐** |
| [`eventsource-parser`](https://github.com/betwixt-labs/eventsource-parser) | 手动控制 | 与 fetch API 配合，更灵活 |

具体的前端实现将在 [**15-前端Chat页面**](15-前端Chat页面.md) 和 [**16-前端ChatClient与useAiChatHook**](16-前端ChatClient与useAiChatHook.md) 中详细展开。

---

## 🔜 下一步预告

Phase 4（前端 UI）的下一个步骤是创建 **Chat 页面**。

在 [**15-前端Chat页面**](15-前端Chat页面.md) 中，我们将：
- 在 `apps/frontend-next/` 中创建 `app/[locale]/ai-chat/page.tsx` Server Component
- 设计页面布局：消息列表 + 输入框 + 侧边栏会话历史
- 处理 i18n 本地化路由参数
- 预留 Client Component 的挂载点

---

## 📚 关键设计决策回顾

1. **SSE over WebSocket**：一问一答模式不需要双向实时通信，SSE 更简单、成本更低
2. **`streamEvents` over `invoke`**：流式体验是 AI 客服的标配，逐 token 显示 + 中间步骤可见
3. **4 种事件类型**：`token` / `step` / `done` / `error`，覆盖消费端所有需求且足够简洁
4. **POST over GET**：虽然 SSE 惯例用 GET，但我们需要通过 request body 传递 message，POST 更合理
5. **Controller 层只负责 I/O**：所有业务逻辑在 Service 层，Controller 只做参数校验 + SSE 写入
