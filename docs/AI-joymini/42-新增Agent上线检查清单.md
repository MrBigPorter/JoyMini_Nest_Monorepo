# 42. 新增 Agent 上线检查清单

> **目的**：确保每次新增 Agent 或修改 Agent Prompt 时，不会引入"越权声明"、"上下文污染"、"工具未注册"等已知问题
> **适用场景**：(1) 新增 Agent (2) 修改现有 Agent 的 prompt (3) 修改 Agent 的工具注册

---

## 使用方式

每次开发完成后，逐条检查并打勾。**有一项未通过就不能上线**。

---

## □ Step 1: 工具注册

### 1.1 创建工具函数

```typescript
// apps/api/src/client/<domain>/tools/<agent-name>.tools.ts
export function create<AgentName>Tools(): DynamicStructuredTool[] { ... }
```

- [ ] 每个工具函数都有 JSDoc 注释说明用途
- [ ] 工具名称遵循命名规范：`<domain>_<action>`（如 `wallet_get_balance`）
- [ ] 工具参数使用 Zod 或 yup 做校验

### 1.2 注册到系统

```typescript
// apps/api/src/client/<domain>/<domain>.module.ts
export class <Domain>Module implements OnApplicationBootstrap {
  constructor(private registry: ToolRegistryService) {}
  onApplicationBootstrap() {
    this.registry.registerMany(
      create<AgentName>Tools().map(t => ({ tag: '<agent-tag>', tool: t }))
    );
  }
}
```

- [ ] `OnApplicationBootstrap` 已实现
- [ ] `registerMany` 已调用
- [ ] `tag` 名称与后续 Agent node 中 `getToolsByTag(tag)` 的 tag **完全一致**
- [ ] domain module 已在对应模块中 import

### 1.3 验证注册（启动后自动检查）

- [ ] 启动项目，观察日志是否有 `ToolRegistry validation passed` 输出
- [ ] 如有 `Missing tools for tag: <xxx>` 报错，必须先修复

---

## □ Step 2: Agent Node

### 2.1 创建 Agent Node 文件

```typescript
// apps/api/src/client/ai-customer/graph/nodes/<agent-name>-agent.node.ts
```

- [ ] 文件按现有模板结构创建（Role → Current Context → Workflow → Tools → Domain Rules → Hard Rules → Example → Display Format）

### 2.2 Prompt 关键检查项

#### ❌ 禁止出现的措辞（全局搜索确认不存在）

| 禁止措辞 | 原因 |
|---------|------|
| `politely guide the user back` | 复合意图场景必现越权声明 Bug |
| `outside my scope` | Agent 不应主动声明"不归我管" |
| `I cannot help with that` | 同上 |
| `please contact another team/department` | 同上 |
| `this is not my field/responsibility` | 同上 |

#### ✅ 必须包含的章节

- [ ] `## Current Context` — 显式声明 `userId`、`locale` 等上下文参数
- [ ] `## Hard Rules` — 铁律区域

#### ✅ Hard Rules 中必须包含 Scope Restriction

```typescript
### CRITICAL: Scope Restriction
- You ONLY handle [domain] topics: [specific list].
- If the user's message mentions topics outside your scope ([other domains]),
  ABSOLUTELY do NOT mention them. Do NOT say "this is outside my scope" or
  "I cannot help with that" or "please contact another team".
  Other specialized assistants will handle those parts.
- Only respond to the [domain]-related part of the user's question.
  Ignore all non-[domain] content completely.
```

- [ ] Scope Restriction 已放在 Hard Rules **最顶部**
- [ ] `[domain]` 替换为实际业务领域名称
- [ ] `[specific list]` 列出该 Agent 负责的所有业务功能
- [ ] `[other domains]` 列出该 Agent **不负责**的已知其他领域

#### ✅ 其他必须规则

- [ ] `## Your Workflow` 或 `## Domain Rules` 中包含 Step-by-step 流程
- [ ] `Example` 中不使用具体数值，使用 `[from tool result]` 占位符
- [ ] 模板变量（userId 等）同时出现在 `## Current Context`（显式声明）**和** `Example`（复用），不只在 Example 中出现

### 2.3 工具获取

```typescript
const tools = registry.getToolsByTag('<agent-tag>');
```

- [ ] tag 名称与 Step 1.2 中注册的 tag 完全一致
- [ ] 有兜底检查：`if (tools.length === 0) { throw new Error(...) }` 或日志告警

---

## □ Step 3: 路由注册

### 3.1 Intent Router

```typescript
// apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts
```

- [ ] INTENT_PROMPT 中新增了该 Agent 的意图描述
- [ ] intent 输出映射到正确的 agent tag（`wallet` | `coupon` | `order` 等）
- [ ] 如需 supervisor 调度，`pendingTasks` 中正确分配 agent 名称

### 3.2 Graph 路由

```typescript
// apps/api/src/client/ai-customer/graph/customer.graph.ts
```

- [ ] 新 Agent node 已添加到 graph 定义中
- [ ] supervisorRouter 或 intentGateway 包含了新 agent 的路由分支
- [ ] 路由条件（如有）与 State 中的字段匹配

---

## □ Step 4: 消息过滤

```typescript
// apps/api/src/client/ai-customer/graph/utils/filter-messages.ts
```

- [ ] 新 Agent 的 messages 过滤逻辑与其他 Agent 一致
- [ ] `'supervised'` 话题消息的过滤已按 `pendingTasks` 过滤（不是无差别保留）
- [ ] 如 Agent 有特殊过滤需求，已在 `filterAgentMessages` 中添加对应分支

---

## □ Step 5: AnswerSynthesizer

```typescript
// apps/api/src/client/ai-customer/graph/nodes/answer-synthesizer.node.ts
```

- [ ] 如新 Agent 的输出中可能包含 disclaimer 类文本，`cleanResult()` 的 pattern 列表是否需要扩充
- [ ] SYNTHESIZER_PROMPT 的 Result Filtering Rule 是否覆盖了新场景

---

## □ Step 6: 编译与测试

### 6.1 编译检查

```bash
yarn workspace @lucky/api tsc --noEmit
```

- [ ] TypeScript 编译通过（exit 0）

### 6.2 单元测试

```bash
yarn workspace @lucky/api test
```

- [ ] 全部已有测试通过
- [ ] 如有必要，新增针对新 Agent 的单元测试

### 6.3 手动测试场景

| 测试场景 | 输入示例 | 预期 |
|---------|---------|------|
| 单领域查询 | "查我的余额" | Agent 正确调用工具返回数据 |
| 复合查询（关键） | "查今天的优惠券和昨天的取款" | 所有相关 Agent 返回数据，**无越权声明** |
| 跨领域拒绝 | 问新 Agent 不负责的领域 | 由 IntentRouter 处理，Agent 不主动拒绝 |
| 边界情况 | 空结果、错误参数 | Agent 正确报告，不编造数据 |

- [ ] 复合查询场景已手动验证通过
- [ ] 确认无"outside scope"类文本出现在最终回复中

---

## □ Step 7: 文档

### 7.1 代码注释

- [ ] Agent node 文件头部有清晰的功能注释
- [ ] 关键逻辑（如特殊过滤、路由条件）有注释说明原因

### 7.2 架构文档

- [ ] 如在 `docs/AI-joymini/` 中有对应的架构文档，更新相关章节
- [ ] 如在 `docs/AI-joymini/38-Agent潜在风险分析与最佳实践.md` 中有相关风险条目，更新

---

## 快速参考表

| Step | 检查内容 | 自动/手动 | 失败后果 |
|------|---------|-----------|---------|
| 1.1 | 工具函数创建 | 手动 | 无工具可调用→LLM编造数据 |
| 1.2 | 工具注册到系统 | **自动**（Layer 1） | 同上 |
| 1.3 | 启动验证 | **自动**（Layer 1） | 启动时报错 |
| 2.2 | Prompt 禁止措辞 | 手动搜索 | 越权声明泄漏（P0-06） |
| 2.2 | Scope Restriction | 手动检查 | 同上 |
| 2.2 | userId 显式声明 | 手动检查 | Agent 反问 userId（P0-03） |
| 2.2 | Example 占位符 | 手动检查 | LLM 编造数据（P0-02） |
| 3 | 路由注册 | 手动检查 | Agent 从不被调度 |
| 4 | 消息过滤 | 手动检查 | 上下文污染（P0-05） |
| 5 | 合并层清洗 | 手动检查 | disclaimer 泄漏到回复 |
| 6.1 | tsc --noEmit | **自动** | 编译失败 |
| 6.2 | 单元测试 | **自动** | 测试失败 |
| 6.3 | 复合查询测试 | 手动 | 最关键的手动验证 |

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-07-02 | v1.0 | 初始版本：新增 Agent 上线检查清单，覆盖工具注册→Prompt→路由→过滤→合并→测试→文档 |
