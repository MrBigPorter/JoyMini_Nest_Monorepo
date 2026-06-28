# AI Agent 工具架构方案 — 概念详解

> 面向 LLM 的 AI Agent 工具注册与调用架构方案对比。
> 对应代码: [`customer.graph.ts`](../../apps/api/src/client/ai-customer/graph/customer.graph.ts), [`order-tools.ts`](../../apps/api/src/client/ai-customer/graph/tools/order-tools.ts), [`order-agent.node.ts`](../../apps/api/src/client/ai-customer/graph/nodes/order-agent.node.ts)

---

## 背景问题

当前 AI Customer 系统只有 `order` 一个 domain 对接了 Agent。随着未来 wallet、coupon、treasure、lucky-draw 等 domain 接入，会出现两个问题：

1. **参数膨胀** — `buildCustomerGraph(llmConfig, orderService, walletService, ...)` 每加一个 domain 就多一个参数
2. **Graph 代码膨胀** — `customer.graph.ts` 每加一个 domain 就要手动注册 tool 和 node

---

## 四种方案详解

### 1. gRPC（Google Remote Procedure Call）

| 项目 | 说明 |
|------|------|
| **是什么** | 一种高性能的**远程调用框架**，让一个服务可以像调用本地函数一样调用另一个服务器上的函数 |
| **传输** | HTTP/2 协议 |
| **数据格式** | Protocol Buffers（protobuf）二进制格式，比 JSON 小 60%-80% |
| **接口定义** | 用 `.proto` 文件定义接口和数据结构，自动生成客户端和服务端代码 |

**解决什么问题：**
- 微服务之间的高效通信
- 强类型的跨语言 RPC 调用
- 需要流式传输（streaming）的场景

**典型场景：**
- Google、Netflix 等大型微服务架构
- 需要极高吞吐量的内部服务通信
- 多语言混搭的技术栈（Go + Python + Java）

**代码示例：**
```protobuf
// order.proto
service OrderService {
  rpc GetOrders (GetOrdersRequest) returns (GetOrdersResponse);
}
message GetOrdersRequest {
  string user_id = 1;
}
```
客户端调用：`orderClient.getOrders({ userId: 'abc' })` — 就像调用本地函数，实际发 HTTP/2 请求到远程服务器。

---

### 2. Service Registry（服务注册模式）

| 项目 | 说明 |
|------|------|
| **是什么** | 一种**设计模式**，把所有可用的 service 统一注册到一个中心对象里 |
| **常见实现** | NestJS DI 容器、Consul、Eureka、etcd（在微服务中） |
| **在本项目中的形式** | 把 `orderService`、`walletService`、`couponService` 合并到一个 `AgentServices` 接口对象里 |

**解决什么问题：**
- 减少函数参数数量（N 个参数变 1 个参数）
- 统一管理服务的生命周期
- 调用者不需要知道具体有哪些服务

**典型场景：**
- 微服务中的服务发现（一个 Service 需要找到另一个 Service 的地址）
- 单体应用中的接口聚合

**代码示例：**
```typescript
// 当前方式 — N 个参数
buildCustomerGraph(llmConfig, orderService, walletService, couponService)

// Registry 方式 — 1 个参数
interface AgentServices {
  order: IOrderService;
  wallet: IWalletService;
  coupon: ICouponService;
}
buildCustomerGraph(llmConfig, services: AgentServices)
```

**局限性：** 解决了参数膨胀，但没解决 Graph 代码膨胀——仍然需要在 `customer.graph.ts` 里为每个 domain 手动写 `createXxxTools()` 和 `addNode()`。

---

### 3. ToolRegistry（工具注册表 — 推荐方案）

| 项目 | 说明 |
|------|------|
| **是什么** | 在 Service Registry 基础上更进一步：不仅注册 service，还注册**最终的工具实例**（`DynamicStructuredTool`） |
| **关键区别** | 调用者（graph/agent）直接拿到**已经组装好的工具**，不需要自己调用 `createOrderTools()` |
| **最终实现** | **NestJS `@Global ToolRegistryModule` + `OnApplicationBootstrap` 编程式注册** + **`TaggedTool` 标签系统** |

**解决什么问题：**
- **service 参数膨胀** ✅ — `buildCustomerGraph(llmConfig, toolRegistry)` 永远 2 个参数
- **graph 代码膨胀** ✅ — `toolRegistry.getToolsByTag('order')` 按需发现，graph 永远不需要改
- **domain 自治** ✅ — 每个 domain 通过 `OnApplicationBootstrap` **自动注册**，不需要手动调用 `register()`
- **Agent 安全** ✅ — `TaggedTool` 标签系统确保 Agent 只拿到自己 domain 的工具

**典型场景：**
- 插件化架构（Plugin System）
- 多个 domain 需要向 AI Agent 提供工具
- 不同 Agent 需要不同权限的工具集

**最终代码示例：**

```typescript
// === tool-registry.service.ts — 核心注册服务 ===
export interface TaggedTool {
  tool: DynamicStructuredTool;
  tags: string[];  // e.g. ['order'], ['wallet']
}

@Injectable()
export class ToolRegistryService {
  private allTaggedTools: TaggedTool[] = [];

  /** 各 domain 模块在 OnApplicationBootstrap 中调用此方法注册工具 */
  registerMany(tools: TaggedTool[]): void {
    this.allTaggedTools.push(...tools);
  }

  getAllTools(): DynamicStructuredTool[] {
    return this.allTaggedTools.map(t => t.tool);
  }

  getToolsByTag(tag: string): DynamicStructuredTool[] {
    return this.allTaggedTools
      .filter(t => t.tags.includes(tag))
      .map(t => t.tool);
  }
}

// === tool-registry.module.ts — @Global 共享模块 ===
@Global()
@Module({
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolRegistryModule {}

// === order.module.ts — 每个 domain 模块通过 OnApplicationBootstrap 自行注册 ===
@Module({
  imports: [PrismaModule, WalletModule, GroupModule, LuckyDrawModule],
  controllers: [OrderController],
  providers: [OrderService, PrismaService],
  exports: [OrderService],
})
export class OrderModule implements OnApplicationBootstrap {
  constructor(
    private readonly orderService: OrderService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  onApplicationBootstrap() {
    const tools = createOrderTools(this.orderService);  // → TaggedTool[]
    this.toolRegistry.registerMany(tools);
  }
}

// === order-tools.ts — 纯函数工厂，返回 TaggedTool[] ===
export const createOrderTools = (orderService: IOrderService): TaggedTool[] => {
  return [
    { tool: tool(/* getUserOrders */), tags: ['order'] },
    { tool: tool(/* getOrderInfo */), tags: ['order'] },
  ];
};

// === order-agent.node.ts — Agent 只拿自己的工具 ===
const tools = registry.getToolsByTag('order');  // ← 只拿 Order 工具
const llmWithTools = llm.bindTools(tools);

// === customer.graph.ts — 永远不变 ===
buildCustomerGraph(llmConfig, registry: ToolRegistryService) {
  // 不需要 import 任何 createXxxTools()
  // 不需要知道有哪些 domain
}
```

**关键概念：**

| 概念 | 说明 |
|------|------|
| `ToolRegistryModule (@Global)` | `@Global()` 模块全局提供 `ToolRegistryService`，任何模块无需显式 import 即可注入 |
| `registerMany()` | 各 domain 模块在 `OnApplicationBootstrap` 钩子中调用此方法注册 `TaggedTool[]` |
| `OnApplicationBootstrap` | NestJS 生命周期钩子，在所有模块初始化完成后执行，确保所有依赖就绪 |
| `TaggedTool` | `{ tool: DynamicStructuredTool, tags: string[] }` — 给工具打标签，按标签过滤 |
| `getToolsByTag('order')` | Agent 节点只拿自己需要的工具，不污染 LLM 上下文 |

**架构演进（4 个阶段）：**

| 阶段 | 方案 | 问题 |
|------|------|------|
| Phase 1 | 手动 `register()` — 每个 domain 在 service 里调用 `registry.register(tool)` | 手动调用只是代码搬迁，参数仍然膨胀 |
| Phase 2 | **NestJS `multi:true` 自动注入** — 在 `*.module.ts` 用 `{ provide: AI_TOOLS, multi: true }` 声明 | Agent 拿到所有 domain 的工具，混淆 LLM |
| Phase 3 | **+ TaggedTool 标签系统** — 每个工具带 `tags: ['order']`，Agent 按需获取 | ✅ 标签隔离，但发现 **钻石依赖作用域隔离问题**：`multi:true` 在多模块嵌套导入时存在 scope 问题，部分 module 的 provider 无法被正确消费 |
| Phase 4 | **`OnApplicationBootstrap` 编程式注册** — 各 domain module 在生命周期钩子中调用 `registerMany()` | ✅ 最终方案：完全避免 DI scope 限制，无钻石依赖问题 |

**为什么是最佳方案：** 零新依赖、零网络开销、完整 TypeScript 类型安全、自动注册无需手动调用、标签隔离确保 Agent 安全、未来可升级为 MCP。

---

### 4. MCP（Model Context Protocol）

| 项目 | 说明 |
|------|------|
| **是什么** | 一个**开放协议标准**，由 Anthropic 提出，定义 AI 应用如何与外部工具/数据源通信 |
| **类比** | USB-C 接口标准——只要设备支持 USB-C，插上就能用 |
| **传输** | stdio（本地进程间通信）或 SSE（Server-Sent Events，远程通信） |
| **数据格式** | JSON-RPC 格式 |

**解决什么问题：**
- AI Agent 调用外部工具时的**标准化问题**（否则每个 Agent 都有自己的工具调用方式）
- **运行时发现**——Agent 启动时自动知道有哪些工具可用
- **跨进程/跨语言**——工具可以用不同的技术栈独立开发

**典型场景：**
- Claude Desktop 的插件系统
- 大型企业有多个团队各自开发工具，通过 MCP 标准统一提供给 AI
- 工具需要独立部署、独立扩缩容

**代码示例：**
```typescript
// MCP Server（独立进程）
server.tool('getUserOrders', schema, async (args) => {
  return orderService.getOrders(args);  // 在自己的进程里运行
});

// 主项目 Agent（另一个进程）
const tools = await mcpClient.listTools();  // → ['getUserOrders', ...]
const result = await mcpClient.callTool('getUserOrders', { userId: 'abc' });
```

**为什么当前不适合本项目：** 所有 domain 都**已经在同一个 NestJS 进程里**，不需要通过 JSON-RPC 跨进程通信。引入网络层、进程管理层、序列化层，收益为零、成本不小。

---

## 对比总结

| 维度 | gRPC | MCP | Service Registry | ★ ToolRegistry |
|------|------|-----|-----------------|----------------|
| 核心关注点 | 跨网络高性能 RPC | AI 工具标准化协议 | 服务聚合 | 工具动态注册 |
| 解决参数膨胀 | ✅ | ✅ | ✅ | ✅ |
| 解决 graph 膨胀 | ✅ | ✅ | ❌ | ✅ |
| 需要新依赖 | 大量 | MCP SDK | 无 | **零** |
| 类型安全 | ✅（protobuf） | ❌（JSON 跨进程） | ✅ | ✅ |
| 本地调用延迟 | 高（HTTP/2） | 高（JSON-RPC） | 无 | **无** |
| 运维复杂度 | 高 | 中 | 无 | **无** |
| 未来扩展性 | 低 | 高 | 低 | **高（可升级 MCP）** |
| **适合你现在？** | ❌ | ❌ | 中间方案 | **★★★ 最佳** |

---

## 推荐路径

```mermaid
flowchart LR
    subgraph 现在
        A[ToolRegistry<br/>OnApplicationBootstrap<br/>@Global ToolRegistryModule<br/>零新依赖]
    end
    subgraph 未来
        B[MCP Adapter<br/>包装 ToolRegistry<br/>成 MCP Server]
    end
    
    A -- 当需要跨进程/跨语言时 --> B
    
    style A fill:#4CAF50,color:white
    style B fill:#FF9800,color:white
```

**Phase 1（现在 ✓）：** 实现 `ToolRegistryService` + `@Global ToolRegistryModule` + `OnApplicationBootstrap` 编程式注册 + `TaggedTool` 标签系统
- 纯 NestJS 实现，零新依赖 ✅
- 每个 domain 模块通过 `OnApplicationBootstrap` 生命周期钩子**自动注册**，不需要手动调用任何注册函数 ✅
- `ToolRegistryModule` 使用 `@Global()` 装饰器，全局提供 `ToolRegistryService` ✅
- `customer.graph.ts` 通过 `registry.getToolsByTag('order')` 按标签获取工具，graph 永远不需要改 ✅
- `buildCustomerGraph` 永远只需 `(llmConfig, toolRegistry)` 两个参数 ✅
- Agent 节点只拿到自己标签的工具，不污染 LLM 上下文 ✅
- TypeScript 编译通过，零错误 ✅

> ⚠️ **坑：NestJS `multi:true` 钻石依赖**
>
> 在 `multi:true` DI 方案（Phase 3）中，当出现**钻石依赖**（如 `AiCustomerModule` 同时导入 `OrderModule` 和 `WalletModule`，而 `OrderModule` 也导入 `WalletModule`）时：
> - NestJS 处理 `OrderModule` → 发现依赖 `WalletModule` → 初始化 `WalletModule` → `WalletModule` 的 `AI_TOOLS` multi-provider 绑定到 `OrderModule` 的作用域
> - NestJS 处理 `AiCustomerModule` → 直接导入 `WalletModule` → 发现 `WalletModule` 已被缓存 → **复用实例** → `AI_TOOLS` 不再重新求值
> - 结果：`WalletModule` 的 `AI_TOOLS` 被 `OrderModule` 作用域"消费"，`ToolRegistryService` 收不到钱包工具
> - **表现**：`llm.bindTools([])` → 空数组 → LLM 退化为 XML 标签调用（如 `<get_wallet_balance>` 幻觉）
> - **修复**：迁移到 Phase 4 编程式注册，完全规避 DI scope 问题

**Phase 2（未来）：** MCP 适配
- 当项目拆分为微服务或需要跨语言工具时
- 创建 `McpAdapter` 把 `ToolRegistryService` 包装成 MCP Server
- 对 Agent 层完全透明，`getToolsByTag()` 返回的内容不变
