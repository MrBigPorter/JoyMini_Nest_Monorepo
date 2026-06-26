# 02. 安装 LangGraph 依赖 + 修复 Module Exports

## 🎯 本步骤目标

1. 安装 `@langchain/core` 和 `@langchain/langgraph` 依赖
2. 修复 4 个 Module 的 exports 配置，使 AiCustomerModule 能注入它们的 Service

---

## 📖 开发背景

### 承上：上一步做了什么？

[01-配置-AiService与Ollama集成.md](01-配置-AiService与Ollama集成.md) 完成了：
- Ollama 本地部署（原生 + Docker）
- 环境变量 `OLLAMA_BASE_URL` 配置
- AiService 自动回退链路（Ollama → DeepSeek → Groq → Gemini）
- Docker Compose 集成（独立文件 + 主文件注释选项）

### 启下：下一步做什么？

下一步 [03-创建AiCustomerModule与GraphState.md](03-创建AiCustomerModule与GraphState.md) 将使用这些依赖创建：
- `AiCustomerModule` — AI 客服模块
- `graph/state.ts` — LangGraph State 定义

### 为什么需要这个步骤？

1. **依赖安装**：NestJS 项目目前没有 `@langchain` 依赖，不安装无法使用 `createReactAgent`、`StateGraph`、`tool()` 等核心 API
2. **Module Exports**：NestJS 的 DI 系统要求：如果你在 Module A 中需要注入 Module B 的 Service，Module B 必须在 `exports` 中暴露该 Service。当前 `OrderModule`、`CouponModule`、`TreasureModule`、`KycModule` 都没有 exports，导致 AiCustomerModule 无法注入它们的 Service

---

## 🔧 前提条件

- [x] NestJS 项目正常运行（`yarn workspace @lucky/api start:dev`）
- [x] 包管理为 Yarn Workspaces
- [x] 01 文档已完成（Ollama + AiService 配置就绪）

---

## ⚙️ 实现步骤

### Step 1: 安装 LangGraph 依赖

在项目根目录执行：

```bash
# 安装 LangChain 核心库和 LangGraph
yarn workspace @lucky/api add @langchain/core@^0.3.0 @langchain/langgraph@^0.2.0

# 安装 LangChain 社区库（用于 ChatOllama 等）
yarn workspace @lucky/api add @langchain/community@^0.3.0

# 如果使用 Ollama，需要安装 Ollama 集成
yarn workspace @lucky/api add @langchain/ollama@^0.1.0

# 确认版本
yarn workspace @lucky/api info @langchain/core --json | grep '"version"'
```

**验证**：检查 `apps/api/package.json` 中应出现：

```json
"dependencies": {
  "@langchain/core": "^0.3.0",
  "@langchain/langgraph": "^0.2.0",
  "@langchain/community": "^0.3.0",
  "@langchain/ollama": "^0.1.0",
  // ... 其他现有依赖保持不变
}
```

### Step 2: 修复 `order.module.ts`

**文件**: [`apps/api/src/client/orders/order.module.ts`](apps/api/src/client/orders/order.module.ts)

```diff
import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { WalletModule } from '@api/client/wallet/wallet.module';
import { LuckyDrawModule } from '@api/common/lucky-draw/lucky-draw.module';

@Module({
  imports: [WalletModule, LuckyDrawModule],
  controllers: [OrderController],
  providers: [OrderService],
- exports: [],
+ exports: [OrderService],
})
export class OrderModule {}
```

### Step 3: 修复 `coupon.module.ts`

**文件**: [`apps/api/src/client/coupon/coupon.module.ts`](apps/api/src/client/coupon/coupon.module.ts)

```diff
import { Module } from '@nestjs/common';
import { ClientCouponService } from './coupon.service';
import { CouponController } from './coupon.controller';

@Module({
  controllers: [CouponController],
  providers: [ClientCouponService],
- exports: [],
+ exports: [ClientCouponService],
})
export class CouponModule {}
```

### Step 4: 修复 `treasure.module.ts`

**文件**: [`apps/api/src/client/treasure/treasure.module.ts`](apps/api/src/client/treasure/treasure.module.ts)

```diff
import { Module } from '@nestjs/common';
import { TreasureController } from './treasure.controller';
import { ShareController } from './share.controller';
import { TreasureService } from './treasure.service';
import { RedisModule } from '@api/common/redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [TreasureController, ShareController],
  providers: [TreasureService],
+ exports: [TreasureService],
})
export class TreasureModule {}
```

### Step 5: 修复 `kyc.module.ts`

**文件**: [`apps/api/src/client/kyc/kyc.module.ts`](/apps/api/src/client/kyc/kyc.module.ts)

KYC 实名认证模块。`KycService` 需要被 AiCustomerModule 注入以创建 KYC Agent。

```diff
import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  controllers: [KycController],
  providers: [KycService],
- exports: [],
+ exports: [KycService],
})
export class KycModule {}
```

### Step 6: 检查其他可能需要 exports 的 Module

**`address.module.ts`** — 检查是否需要导出 AddressService：

```typescript
// apps/api/src/client/address/address.module.ts
// 如果当前没有 exports，需要添加：
// exports: [AddressService],
```

**`flash-sale.module.ts`** — 检查是否需要导出 ClientFlashSaleService：

```typescript
// apps/api/src/client/flash-sale/flash-sale.module.ts
// 如果当前没有 exports，需要添加：
// exports: [ClientFlashSaleService],
```

**`auth.module.ts`** — 检查是否需要导出 AuthService（用于用户信息查询）：

```typescript
// apps/api/src/client/auth/auth.module.ts
// 如果当前没有 exports，需要添加：
// exports: [AuthService],
```

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build

# 运行测试
yarn workspace @lucky/api test
```

---

## 📝 技术要点

1. **`@langchain/core`**（^0.3.x）：提供核心抽象如 `BaseChatModel`, `tool()`, `zodToJsonSchema`
2. **`@langchain/langgraph`**（^0.2.x）：提供 `StateGraph`, `Annotation`, `createReactAgent`, `addMessages`
3. **`@langchain/ollama`**（^0.1.x）：提供 `ChatOllama` 类，兼容 OpenAI API
4. **NestJS Module exports**：只有 exports 的 provider 才能被其他 Module 注入。AiCustomerModule 需要注入：OrderService, WalletService, ClientWalletService, ClientCouponService, AuthService（profile）, AddressService, TreasureService, GroupService, LuckyDrawService, ClientFlashSaleService, KycService

---

## 🔜 下一步预告

在 [03-创建AiCustomerModule与GraphState.md](03-创建AiCustomerModule与GraphState.md) 中，我们将：
- 创建 `apps/api/src/client/ai-customer/` 目录结构
- 定义 `ai-customer.module.ts`（导入所有业务 Module，含 KycModule）
- 定义 LangGraph `AgentState`（使用 Annotation.Root）
- 建立完整的文件骨架
