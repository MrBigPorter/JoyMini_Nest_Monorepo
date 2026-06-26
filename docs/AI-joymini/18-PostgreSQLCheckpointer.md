# 18. PostgreSQL Checkpointer（跨会话对话记忆）

## 🎯 本步骤目标

使用 LangGraph 的 `PostgresSaver` 实现**跨会话对话历史持久化**，让 AI 客服能够记住用户之前的对话内容，支持多会话隔离和上下文恢复。

---

## 📖 背景说明

### 承上

在 [**05-AnswerSynthesizer与Graph组装**](05-AnswerSynthesizer与Graph组装.md) 中，我们使用 `graph.compile()` 编译了 LangGraph 实例。目前每次调用 `graph.invoke()` 都是**无状态的**——下一次对话不会记得上一次说了什么。

在 [**17-完整RAG节点**](17-完整RAG节点.md) 中，我们实现了基于 pgvector 的知识库检索，但那是**静态知识**的检索，不是**对话历史**的记忆。

### 这一步要解决的问题

1. **无状态对话** — 每次调用 `graph.invoke()` 都从零开始，用户需要重复之前的上下文
2. **跨会话记忆** — 用户离开后回来，AI 能记住之前的对话内容
3. **多会话隔离** — 同时与多个用户对话，不会互相干扰
4. **历史回溯** — 管理员可以查看用户与 AI 的完整对话记录

### 设计决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| Checkpointer 实现 | `PostgresSaver` / `SqliteSaver` / `MemorySaver` | **`PostgresSaver`** | 项目已使用 PostgreSQL，一致性强；支持生产级持久化 |
| 会话标识 | `thread_id` | **`thread_id` = `userId`** | 一个用户一个会话，简单直接 |
| 消息保留策略 | 全部保留 / 滑动窗口 / 摘要压缩 | **滑动窗口（最近 50 条）** | 避免无限增长，保留足够上下文 |
| 跨会话恢复 | 自动 / 手动 | **自动恢复** | 同 `thread_id` 自动加载上次对话状态 |

---

## ⚙️ 前置条件

### 环境要求

- `@langchain/langgraph` v0.2+（已在 [02](02-安装LangGraph依赖与修复ModuleExports.md) 中安装）
- `@langchain/langgraph-checkpoint-postgres` 包需要安装
- PostgreSQL 数据库连接可用（项目已有 `PrismaService`）

### 文件/配置准备

- [`customer.graph.ts`](05-AnswerSynthesizer与Graph组装.md) 已实现
- [`ai-customer.service.ts`](05-AnswerSynthesizer与Graph组装.md) 已实现 `initGraph()` + `chatStream()`

### 知识准备

- LangGraph Checkpointer 概念：`Checkpoint` / `Thread` / `Write`
- LangGraph `PostgresSaver` API
- LangGraph `thread_id` 多会话机制

---

## 📝 实现步骤

### Step 1: 安装 Postgres Checkpointer 依赖

```bash
cd apps/api
yarn add @langchain/langgraph-checkpoint-postgres
```

> **注意**：LangGraph v0.2+ 将 `PostgresSaver` 从核心包分离到独立包 `@langchain/langgraph-checkpoint-postgres`。

### Step 2: 创建 Checkpointer 工厂

**文件**：`apps/api/src/client/ai-customer/graph/checkpointer.ts`

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';
import { Logger } from '@nestjs/common';

const logger = new Logger('CheckpointerFactory');

// 单例：全局只创建一个 PostgresSaver
let checkpointerInstance: PostgresSaver | null = null;

/**
 * 获取 PostgresSaver 实例
 * 使用 NestJS 的数据库连接配置
 */
export async function getCheckpointer(databaseUrl?: string): Promise<PostgresSaver> {
  if (checkpointerInstance) {
    return checkpointerInstance;
  }

  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }

  // 创建 PostgreSQL 连接池
  const pool = new Pool({
    connectionString: url,
    max: 5,               // 最大连接数（避免占用过多数据库连接）
    idleTimeoutMillis: 30000,
  });

  // 创建 PostgresSaver
  const saver = new PostgresSaver({
    pool,
    schema: 'public',     // 使用 public schema
    tableName: 'langgraph_checkpoints',   // 自定义表名
  });

  // 初始化表结构（如果没有则自动创建）
  await saver.setup().catch((err) => {
    logger.warn(`Checkpointer setup warning (may already exist): ${err.message}`);
  });

  checkpointerInstance = saver;
  return saver;
}

/**
 * 关闭 Checkpointer 连接（应用关闭时调用）
 */
export async function closeCheckpointer(): Promise<void> {
  if (checkpointerInstance) {
    await checkpointerInstance.pool.end().catch(() => {});
    checkpointerInstance = null;
  }
}
```

### Step 3: 自动创建 Checkpointer 表

`PostgresSaver.setup()` 会自动创建以下表：

```sql
-- LangGraph Checkpointer 表结构（自动创建）
CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
  thread_id     TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  parent_id     TEXT,
  checkpoint    BYTEA,
  metadata      JSONB,
  PRIMARY KEY (thread_id, checkpoint_id)
);

-- 辅助索引
CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id
  ON langgraph_checkpoints (thread_id);
```

### Step 4: 更新 `AiCustomerService` 集成 Checkpointer

**文件**：`apps/api/src/client/ai-customer/ai-customer.service.ts`

```typescript
import { getCheckpointer, closeCheckpointer } from './graph/checkpointer';

@Injectable()
export class AiCustomerService implements OnModuleInit {
  private graph: CompiledStateGraph<any, any>;
  private checkpointer: PostgresSaver | null = null;

  async onModuleInit() {
    // 初始化 Checkpointer
    this.checkpointer = await getCheckpointer().catch((err) => {
      this.logger.warn(`Checkpointer initialization failed, running without memory: ${err.message}`);
      return null;
    });

    this.initGraph();
  }

  private initGraph() {
    // 编译图时传入 checkpointer
    this.graph = buildCustomerGraph();

    if (this.checkpointer) {
      this.graph = this.graph.compile({ checkpointer: this.checkpointer });
    } else {
      this.graph = this.graph.compile();
    }
  }

  async chatStream(
    userId: string,
    message: string,
    onEvent: (type: string, data: any) => void,
    onError: (error: Error) => void,
    onDone: () => void,
  ): Promise<void> {
    try {
      const initialState = {
        messages: [new HumanMessage(`[当前用户ID: ${userId}]\n${message}`)],
        intent: null,
        agentOutput: null,
        userId,
      };

      // 关键：传入 thread_id，LangGraph 自动恢复该 thread 的上一个 checkpoint
      const config = {
        configurable: {
          thread_id: `ai-customer-${userId}`,   // 以 userId 为维度隔离
        },
      };

      // 使用 streamEvents 时传入 config
      const eventStream = await this.graph.streamEvents(initialState, {
        ...config,
        version: 'v2',
      });

      // ... 事件处理（同文档 14）...
    } catch (err) {
      // ... 错误处理 ...
    }
  }

  async onApplicationShutdown() {
    await closeCheckpointer();
  }
}
```

### Step 5: 实现对话历史查询 API（可选）

**文件**：`apps/api/src/client/ai-customer/ai-customer.controller.ts`

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getCheckpointer } from './graph/checkpointer';

@Controller('ai-customer')
@UseGuards(JwtAuthGuard)
export class AiCustomerController {
  @Get('history')
  async getHistory(
    @CurrentUserId() userId: string,
    @Query('limit') limit: number = 20,
  ) {
    const checkpointer = await getCheckpointer();
    const threadId = `ai-customer-${userId}`;

    // 获取该 thread 的所有 checkpoint 列表
    const checkpoints = await checkpointer.list(threadId, { limit });

    // 从 checkpoints 中提取消息
    const messages: any[] = [];
    for (const cp of checkpoints) {
      const checkpoint = cp.checkpoint;
      if (checkpoint?.channel_values?.messages) {
        const msgs = checkpoint.channel_values.messages;
        for (const msg of msgs) {
          messages.push({
            role: msg._getType(),     // 'human' | 'ai' | 'tool'
            content: msg.content,
            timestamp: msg.additional_kwargs?.timestamp,
          });
        }
      }
    }

    return { messages: messages.slice(-limit) };
  }
}
```

### Step 6: 配置环境变量

确保 `DATABASE_URL` 环境变量已配置：

```bash
# .env.dev — 开发环境
DATABASE_URL="postgresql://user:password@localhost:5432/joymini?schema=public"
```

Postgres Checkpointer 会复用同一个数据库连接。

---

## ✅ 验收方式

### 手动验证

```bash
# 1. 启动服务
cd apps/api && yarn start:dev

# 2. 第一轮对话
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "我的用户名是什么？"}'
# → AI 回答用户信息

# 3. 第二轮对话（同一用户）
curl -X POST http://localhost:3000/ai-customer/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "我刚才问了什么？"}'
# → AI 应该记得上一条消息的内容
```

### 预期结果

```bash
# 第二轮对话
data: {"type":"token","content":"您刚才问了“我的用户名是什么？”，"}
data: {"type":"token","content":"您的昵称是 张三，会员等级是 金卡会员。"}
data: {"type":"done",{}}
```

### 数据库验证

```sql
-- 查看 checkpointer 表
SELECT thread_id, checkpoint_id, parent_id, metadata
FROM langgraph_checkpoints
WHERE thread_id = 'ai-customer-{userId}'
ORDER BY checkpoint_id DESC
LIMIT 5;

-- 预期输出
-- thread_id          | checkpoint_id | parent_id | metadata
-- ai-customer-xxx   | ...001        | NULL      | {"source": "input"}
-- ai-customer-xxx   | ...002        | ...001    | {"source": "loop"}
-- ai-customer-xxx   | ...003        | ...002    | {"source": "loop"}
-- ai-customer-xxx   | ...004        | ...003    | {"source": "output"}
```

### 并发隔离验证

```bash
# 用户 A 的对话
curl -X POST ... -H "Authorization: Bearer $TOKEN_A" -d '{"message": "我喜欢红色"}'

# 用户 B 的对话（不应看到 A 的内容）
curl -X POST ... -H "Authorization: Bearer $TOKEN_B" -d '{"message": "我喜欢蓝色"}'

# 分别恢复 → AI 只记得各自用户的历史
```

---

## 🔜 下一步预告

在 [**19-MultiAgentSupervisor与HITL**](19-MultiAgentSupervisor与HITL.md) 中，我们将：
- 实现 **Supervisor Agent** 模式：一个主 Agent 调度多个子 Agent
- 实现 **Human-in-the-Loop**：写操作（退款/提现/领取优惠券）需要用户确认后执行
- 探索更复杂的 Multi-Agent 协作模式

---

## 📚 关键设计决策回顾

1. **`thread_id` = `ai-customer-{userId}`**：以用户为维度隔离会话，简单有效
2. **滑动窗口保留**：LangGraph 的 PostgresSaver 默认保留所有 checkpoint；可以通过 `checkpointer.list()` 分页查询
3. **单例 Checkpointer**：全局共享一个 Postgres 连接池，避免每次请求都创建新连接
4. **`setup()` 自动建表**：表不存在时自动创建，无需手动 SQL 迁移
5. **降级策略**：Checkpointer 初始化失败时，系统降级为无记忆模式（`this.checkpointer = null`），不影响核心功能
