# 03. 创建 AiCustomerModule + Graph State 定义

## 🎯 本步骤目标

1. 创建 `apps/api/src/client/ai-customer/` 目录结构及骨架文件
2. 定义 `ai-customer.module.ts` — 导入所有业务 Module（含新增的 KycModule）
3. 定义 LangGraph State（使用 `Annotation.Root`）
4. 在 `client.module.ts` 中注册 AiCustomerModule

---

## 📖 开发背景

### 承上：上一步做了什么？

[02-安装LangGraph依赖与修复ModuleExports.md](02-安装LangGraph依赖与修复ModuleExports.md) 完成了：
- 安装 `@langchain/core`, `@langchain/langgraph`, `@langchain/ollama` 依赖
- 修复 `order.module.ts`、`coupon.module.ts`、`treasure.module.ts`、`kyc.module.ts` 的 exports

### 启下：下一步做什么？

下一步 [04-创建9Intent路由节点.md](04-创建9Intent路由节点.md) 将创建：
- `graph/nodes/intent-router.node.ts` — 意图路由节点
- 使用 `ChatOllama` 将用户输入分类到不同 Agent

### 架构中的位置

```
client.module.ts
  └── AiCustomerModule (本步骤)
        ├── AiCustomerController (REST API 入口)
        ├── AiCustomerService (业务逻辑 + Graph 管理)
        ├── 导入的业务 Module:
        │     ├── OrderModule ────── OrderService
        │     ├── WalletModule ───── WalletService, ClientWalletService
        │     ├── CouponModule ───── ClientCouponService
        │     ├── TreasureModule ─── TreasureService
        │     ├── AddressModule ──── AddressService
        │     ├── FlashSaleModule ── ClientFlashSaleService
        │     ├── GroupModule ────── GroupService
        │     ├── LuckyDrawModule ── LuckyDrawService
        │     ├── KycModule ──────── KycService (新增)
        │     └── AuthModule ─────── AuthService
        └── Graph (后续步骤逐步添加)
              ├── graph/state.ts (本步骤)
              ├── graph/tools/ (06-11 步骤)
              ├── graph/nodes/ (04-11 步骤)
              └── graph/customer.graph.ts (05 步骤)
```

---

## 🔧 前提条件

- [x] 02 文档已完成（LangGraph 依赖 + Module exports 修复）
- [x] 所有涉及的业务 Module 都已正确 exports 它们的 Service
- [x] 了解 NestJS Module 结构

---

## ⚙️ 实现步骤

### Step 1: 创建目录结构

```bash
# 在 apps/api/src/client/ 下创建 ai-customer 目录
mkdir -p apps/api/src/client/ai-customer/graph/tools
mkdir -p apps/api/src/client/ai-customer/graph/nodes
mkdir -p apps/api/src/client/ai-customer/knowledge
```

### Step 2: 创建 `ai-customer.module.ts`

**文件**: `apps/api/src/client/ai-customer/ai-customer.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { OrderModule } from '@api/client/orders/order.module';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { CouponModule } from '@api/client/coupon/coupon.module';
import { TreasureModule } from '@api/client/treasure/treasure.module';
import { AddressModule } from '@api/client/address/address.module';
import { FlashSaleModule } from '@api/client/flash-sale/flash-sale.module';
import { GroupModule } from '@api/common/group/group.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';
import { KycModule } from '@api/client/kyc/kyc.module';
import { AuthModule } from '@api/client/auth/auth.module';
import { AiCustomerController } from './ai-customer.controller';
import { AiCustomerService } from './ai-customer.service';
// Graph providers will be added in subsequent steps

@Module({
  imports: [
    OrderModule,
    WalletModule,
    CouponModule,
    TreasureModule,
    AddressModule,
    FlashSaleModule,
    GroupModule,
    LuckyDrawModule,
    KycModule,
    AuthModule,
  ],
  controllers: [AiCustomerController],
  providers: [
    AiCustomerService,
    // Graph providers, tools, and nodes will be added here
    // in subsequent step documents (05, 06-11, 11.5)
  ],
})
export class AiCustomerModule {}
```

**注意**：`KycModule` 是本步骤新增的导入（对应 [11.5-KYC-Agent与Tools.md](11.5-KYC-Agent与Tools.md) 的 KYC Agent）。`AuthModule` 需要导出 `AuthService` 才能在 AiCustomerModule 中使用 `profile()` 方法。如果 `auth.module.ts` 当前没有 exports，也需要修复：

```diff
// apps/api/src/client/auth/auth.module.ts
+ exports: [AuthService],
```

### Step 3: 创建 AiCustomerService 骨架

**文件**: `apps/api/src/client/ai-customer/ai-customer.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '@api/common/ai/ai.service';
// Graph-related imports will be added in subsequent steps

@Injectable()
export class AiCustomerService {
  private readonly logger = new Logger(AiCustomerService.name);
  private compiledGraph: any = null; // Will be set in graph setup step

  constructor(
    private readonly aiService: AiService,
    // Service injections will be added as tools are created
  ) {}

  /**
   * Initialize and compile the LangGraph
   * Called once on module init or lazily on first request
   */
  async initGraph() {
    if (this.compiledGraph) return;
    
    // Graph assembly will be implemented in step 05
    this.logger.log('AiCustomerGraph initialized');
  }

  /**
   * Main chat entry point (streaming)
   */
  async chatStream(input: string, userId: string, sessionId: string) {
    if (!this.compiledGraph) await this.initGraph();
    
    // Streaming implementation will be in step 14
    throw new Error('Not implemented yet');
  }
}
```

### Step 4: 创建 Controller 骨架

**文件**: `apps/api/src/client/ai-customer/ai-customer.controller.ts`

```typescript
import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { AiCustomerService } from './ai-customer.service';

@ApiTags('AI Customer Service')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-customer')
export class AiCustomerController {
  constructor(private readonly aiCustomerService: AiCustomerService) {}

  // Chat endpoints will be implemented in step 14
}
```

### Step 5: 定义 LangGraph State

**文件**: `apps/api/src/client/ai-customer/graph/state.ts`

```typescript
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

/**
 * AI 客服 Agent 的 State 定义
 *
 * 使用 Annotation.Root 模式：
 * - messages: 对话消息列表，使用 messagesStateReducer 自动追加
 * - intent: 当前分类意图（由 intentRouter 节点设置）
 * - agentSteps: Agent 执行步骤记录（用于 SSE 流式输出）
 * - sources: RAG 检索来源
 */
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  intent: Annotation<string>({
    reducer: (a: string, b: string) => b,
    default: () => '',
  }),
  agentSteps: Annotation<any[]>({
    reducer: (a: any[], b: any[]) => a.concat(b),
    default: () => [],
  }),
  sources: Annotation<any[]>({
    reducer: (a: any[], b: any[]) => a.concat(b),
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
```

### Step 6: 在 `client.module.ts` 中注册 AiCustomerModule

**文件**: [`apps/api/src/client/client.module.ts`](/apps/api/src/client/client.module.ts)

```diff
import { Module } from '@nestjs/common';
// ... 其他 imports ...
+ import { AiCustomerModule } from './ai-customer/ai-customer.module';

@Module({
  imports: [
    // ... 其他 Module ...
+   AiCustomerModule,
  ],
})
export class ClientModule {}
```

---

## ✅ 验证

```bash
# 确保没有 Module 导入/DI 错误
yarn workspace @lucky/api build
```

---

## 📝 技术要点

### Annotation.Root 模式

LangGraph v0.2 使用 `Annotation.Root` 替代旧版的 `StateGraph` 泛型参数：

```typescript
// 新版（v0.2+）
const AgentState = Annotation.Root({ ... })
type AgentStateType = typeof AgentState.State

// 在 Agent 中使用
const agent = createReactAgent({
  // ...
})
const result = await agent.invoke({ messages: [...] })
```

### 为什么使用 `reducer: (a, b) => b`？

对于 `intent` 这种**覆盖型**字段（每次设置新值替换旧值），使用 `(a, b) => b` reducer。对于 `messages` 这种**累积型**字段，使用 `messagesStateReducer` 自动追加。

### Module 依赖树

```
ClientModule
  └── AiCustomerModule (本步骤)
        ├── OrderModule → OrderService
        ├── WalletModule → WalletService + ClientWalletService
        ├── CouponModule → ClientCouponService
        ├── TreasureModule → TreasureService
        ├── AddressModule → AddressService
        ├── FlashSaleModule → ClientFlashSaleService
        ├── GroupModule → GroupService
        ├── LuckyDrawModule → LuckyDrawService
        ├── KycModule → KycService
        └── AuthModule → AuthService
```

---

## 🔜 下一步预告

在 [04-创建9Intent路由节点.md](04-创建9Intent路由节点.md) 中，我们将：
- 创建 10-Intent 意图路由节点（含新增的 `kyc` 意图）
- 使用 `ChatOllama` + PromptTemplate 实现分类
- 实现 `routeByIntent` 条件边函数
