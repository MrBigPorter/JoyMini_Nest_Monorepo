# 10. Product + Group Agent + Tools（商品与拼团助手）

## 🎯 本步骤目标

1. 创建 `graph/tools/product-tools.ts` — 4 个商品/拼团工具的工厂函数
2. 创建 `graph/nodes/product-agent.node.ts` — 使用 `createReactAgent` 构建 Product ReAct Agent
3. 掌握 `TreasureService` 和 `GroupService` 的协作

完成本步骤后，`productAgent` 节点可以处理"搜索商品"、"查看商品详情"、"拼团信息"等商品相关查询。

---

## 📖 开发背景

### 承上：上一步做了什么？

[09-UserAddressAgent与Tools.md](09-UserAddressAgent与Tools.md) 完成了：
- `graph/tools/user-tools.ts` — 3 个用户/地址工具的工厂函数
- `graph/nodes/user-agent.node.ts` — User ReAct Agent
- `AuthService.profile()` 和 `AddressService` 的使用

### 启下：下一步做什么？

下一步 [11-LuckyDrawFlashAgent与Tools.md](11-LuckyDrawFlashAgent与Tools.md) 将实现最后一个 ReAct Agent：
- LuckyDraw+Flash Agent — 处理抽奖券、中奖记录、闪购场次
- 5 个工具的工厂函数

### 架构中的位置

```
用户输入 → intentRouter (product) → productAgent (本步骤)
                                       ├── treasure_list (商品搜索列表)
                                       ├── treasure_detail (商品详情)
                                       ├── group_list (拼团列表)
                                       └── group_detail (拼团详情)
                                    → answerSynthesizer
```

---

## 🔧 前提条件

- [x] 06 文档已完成（Agent 工厂函数模式）
- [x] `treasure.module.ts` 已修复 exports（`exports: [TreasureService]`）
- [x] `GroupModule` 在 `@api/common/group` — 需确认已正确 exports

### Service 方法速查

| Service | 方法 | 行号 | 参数 | 说明 |
|---------|------|------|------|------|
| `TreasureService` | `list` | [`treasure.service.ts`](apps/api/src/client/treasure/treasure.service.ts):30 | `query: TreasureQueryDto` | 商品列表，支持 keyword/category 筛选 |
| `TreasureService` | `detail` | [`treasure.service.ts`](apps/api/src/client/treasure/treasure.service.ts):159 | `id: string` | 商品详情，含 ruleContent, desc, shippingType |
| `GroupService` | `listGroupForTreasure` | [`group.service.ts`](apps/api/src/common/group/group.service.ts):~551 | `(userId?, dto)` | 指定商品的进行中拼团列表 |
| `GroupService` | `getGroupDetail` | [`group.service.ts`](apps/api/src/common/group/group.service.ts):~610 | `(groupId)` | 团详情 + 成员信息 |

---

## ⚙️ 实现步骤

### Step 1: 创建 Product Tools 工厂函数

**文件**: `apps/api/src/client/ai-customer/graph/tools/product-tools.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TreasureService } from '@api/client/treasure/treasure.service';
import { GroupService } from '@api/common/group/group.service';

/**
 * 商品/拼团工具 — 工厂函数
 *
 * 包含商品搜索、商品详情和拼团信息查询。
 * TreasureService 处理商品，GroupService 处理拼团。
 *
 * @param treasureService - TreasureService 实例
 * @param groupService - GroupService 实例
 * @returns LangChain tool 数组
 */
export function createProductTools(
  treasureService: TreasureService,
  groupService: GroupService,
) {
  /**
   * Tool 1: 商品搜索/列表
   *
   * 搜索商品列表，支持关键词、分类筛选。
   * 注意：商品列表不需要 userId（未登录也可浏览），
   * 但拼团信息可能需要 userId。
   */
  const treasureListTool = tool(
    async ({ keyword, category, page, pageSize }) => {
      try {
        const result = await treasureService.list({
          keyword,
          category,
          page,
          pageSize,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询商品列表失败：${error.message}`;
      }
    },
    {
      name: 'treasure_list',
      description:
        '搜索或浏览商品列表。支持按关键词搜索和分类筛选，支持分页。不需要用户登录即可使用。',
      schema: z.object({
        keyword: z.string().optional().describe('搜索关键词（如：蓝牙耳机、手机壳）'),
        category: z.string().optional().describe('商品分类ID'),
        page: z.number().optional().default(1).describe('页码'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 2: 商品详情
   *
   * 根据商品ID查询完整商品信息，包括描述、规格、配送方式等。
   */
  const treasureDetailTool = tool(
    async ({ id }) => {
      try {
        const result = await treasureService.detail(id);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询商品详情失败：${error.message}`;
      }
    },
    {
      name: 'treasure_detail',
      description:
        '根据商品ID查询商品详细信息，包括商品描述、规格参数、价格、库存、配送方式等。' +
        '用户需要提供商品ID。',
      schema: z.object({
        id: z.string().describe('商品ID'),
      }),
    },
  );

  /**
   * Tool 3: 拼团列表
   *
   * 查询指定商品的进行中拼团信息。
   */
  const groupListTool = tool(
    async ({ treasureId, page, pageSize }) => {
      try {
        const result = await groupService.listGroupForTreasure(null, {
          treasureId,
          page,
          pageSize,
        } as any);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询拼团列表失败：${error.message}`;
      }
    },
    {
      name: 'group_list',
      description:
        '查询指定商品的进行中拼团列表。用户需要提供商品ID（treasureId）。' +
        '返回正在进行中的拼团信息，包括已参团人数、拼团总人数要求等。',
      schema: z.object({
        treasureId: z.string().describe('商品ID'),
        page: z.number().optional().default(1).describe('页码'),
        pageSize: z.number().optional().default(10).describe('每页数量'),
      }),
    },
  );

  /**
   * Tool 4: 拼团详情
   *
   * 根据拼团ID查询该团的详细信息，包括成员列表。
   */
  const groupDetailTool = tool(
    async ({ groupId }) => {
      try {
        const result = await groupService.getGroupDetail(groupId);
        return JSON.stringify(result);
      } catch (error: any) {
        return `查询拼团详情失败：${error.message}`;
      }
    },
    {
      name: 'group_detail',
      description:
        '根据拼团ID查询拼团详情，包括拼团状态、成员列表、团长信息、剩余时间等。' +
        '用户需要提供拼团ID。',
      schema: z.object({
        groupId: z.string().describe('拼团ID'),
      }),
    },
  );

  return [treasureListTool, treasureDetailTool, groupListTool, groupDetailTool];
}
```

### Step 2: 创建 Product Agent 节点

**文件**: `apps/api/src/client/ai-customer/graph/nodes/product-agent.node.ts`

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOllama } from '@langchain/ollama';
import { TreasureService } from '@api/client/treasure/treasure.service';
import { GroupService } from '@api/common/group/group.service';
import { createProductTools } from '../tools/product-tools';
import { AgentStateType } from '../state';

/**
 * 构建 Product ReAct Agent
 *
 * 处理商品搜索、商品详情、拼团列表和拼团详情查询。
 * 商品查询不需要 userId（未登录可浏览），但拼团可能需要。
 */
function buildProductAgent(
  treasureService: TreasureService,
  groupService: GroupService,
) {
  return createReactAgent({
    llm: new ChatOllama({
      model: 'qwen3.5:0.8b',
      temperature: 0.1,
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    }),
    tools: createProductTools(treasureService, groupService),
    recursionLimit: 10,
  });
}

/**
 * Product Agent Node 工厂函数
 */
export function createProductAgentNode(
  treasureService: TreasureService,
  groupService: GroupService,
) {
  const agent = buildProductAgent(treasureService, groupService);

  return async (
    state: typeof AgentState.State,
  ): Promise<Partial<typeof AgentState.State>> => {
    const lastMessage = state.messages[state.messages.length - 1];

    try {
      const result = await agent.invoke({
        messages: [
          {
            role: 'user',
            content: `[当前用户ID: ${state.userId}]\n${lastMessage.content}`,
          },
        ],
      });

      const lastResultMessage = result.messages[result.messages.length - 1];
      const output =
        typeof lastResultMessage?.content === 'string'
          ? lastResultMessage.content
          : JSON.stringify(lastResultMessage?.content ?? '');

      return {
        agentOutput: output,
        messages: result.messages,
      };
    } catch (error: any) {
      return {
        agentOutput: `商品查询出错：${error.message}`,
      };
    }
  };
}
```

### Step 3: 商品查询的典型对话

```
用户: "搜索蓝牙耳机"
Agent: 调用 treasure_list({ keyword: "蓝牙耳机" }) → 返回列表
Agent: "亲，为您找到以下蓝牙耳机：
       1. 蓝牙耳机 X1 Pro — ¥299（销量 1000+）
       2. 蓝牙耳机 X1 Lite — ¥199（销量 500+）
       请问您想看哪个的详情？"

用户: "看看 X1 Pro"
Agent: "请提供商品ID"
用户: "ID 是 t-001"
Agent: 调用 treasure_detail({ id: "t-001" }) → 返回详情
Agent: "蓝牙耳机 X1 Pro
       - 价格：¥299
       - 颜色：黑色/白色
       - 续航：30小时
       - 描述：主动降噪、IPX5防水
       这个商品正在拼团中，需要查看拼团信息吗？"

用户: "看看拼团"
Agent: 调用 group_list({ treasureId: "t-001" }) → 返回列表
Agent: "目前有 2 个进行中的拼团：
       1. 2人团（已有1人，还差1人）
       2. 3人团（已有2人，还差1人）
       要查看某个团的详情吗？"
```

---

## ✅ 验证

```bash
# 编译检查
yarn workspace @lucky/api build
```

---

## 📝 技术要点

### 商品工具不需要 userId

`treasure_list` 和 `treasure_detail` 不需要 `userId` 参数，因为商品浏览是公开功能。这与订单、钱包等需要用户认证的工具不同。

### GroupService 的特性

`GroupService` 位于 `@api/common/group`（common 模块），而不是 `@api/client`。这意味着它同时服务于客户端和管理端。

在 `ai-customer.module.ts` 中导入时需要注意路径：

```typescript
import { GroupModule } from '@api/common/group/group.module';
// 而不是 @api/client/group/...
```

### 商品 + 拼团的关联查询

商品和拼团是紧密关联的：用户看商品时很自然会问拼团信息。Agent 可以主动提供："这个商品正在拼团中，需要查看吗？"这种主动推荐需要 LLM 根据工具的描述来做出判断。

---

## 🔜 下一步预告

在 [11-LuckyDrawFlashAgent与Tools.md](11-LuckyDrawFlashAgent与Tools.md) 中，我们将实现最后一个 ReAct Agent：
- **LuckyDraw+Flash Agent** — 处理抽奖券、中奖记录、执行抽奖、闪购场次
- **5 个 Tools**：`lucky_tickets`、`lucky_results`、`lucky_draw`、`flash_sessions`、`flash_products`
- **写操作**：`draw` 的原子性处理和确认提示
