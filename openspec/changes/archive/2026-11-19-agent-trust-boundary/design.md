# Design

## Context

工具当前这样定义（`graph/tools/coupon-tools.ts` 等多处）：

```ts
userId: z.string().describe('The current user ID'),
```

注释写着「userId 由 LLM 通过 tool 参数自动传递（方案A）」。工具工厂的签名是 `createCouponTools(couponService)`，身份来自模型而非调用链。

与此同时，调用链上其实**已经拿得到身份**：`runStandardAgent(opts)` 的 `opts.userId` 会传给 `buildAgentPrompt`。也就是说，闭包注入不需要新增数据来源，只需要改变传递路径。

其余四处缺口：

| 缺口 | 现状 |
|---|---|
| 确认名单 | `CONFIRM_REQUIRED_TOOLS` 只有 5 个：`applyWithdraw` / `claimCoupon` / `redeemCouponCode` / `draw` / `deleteAddress` |
| 输出白名单 | `ai-stream.handler.ts` 直接转发事件，未按帧类型过滤 |
| Socket 触发 | 与 HTTP 路径共用服务但未共用限流 |
| 消息序号 | `ChatMessage` 无 `(conversationId, seqId)` 唯一约束 |

## Goals / Non-Goals

**Goals:**

- 让「操作主体」在类型层面就不可能来自模型
- 让「哪些工具需要确认」由声明推导，而不是手工清单
- 让客户端只可能收到面向用户的帧

**Non-Goals:**

- 不引入 RBAC 或任何角色体系（客户端用户没有角色）
- 不重写 ReAct 循环
- 不改资金结算与提现业务逻辑
- 不做完整的 OWASP LLM Top-10 覆盖（只做注入检测与输出过滤两条）

## Decisions

### D1. 身份用请求上下文注入，工具通过 `requireToolUserId` 读取（实现与初稿不同）

初稿设想「工厂签名增加 `ctx: { userId }`」。实施时改为 **AsyncLocalStorage 请求上下文**，
工厂签名保持不变：

```ts
// 入口（HTTP / Socket / 队列）统一包一层：
runWithContext({ traceId, userId }, () => graph.invoke(...));

// 工具内部：
const userId = requireToolUserId('claimCoupon'); // 缺失直接抛 MISSING_USER_CONTEXT
```

**为什么改**：工具工厂有 9 个，且分布在多个 Nest Module；逐个加 `ctx` 会把身份参数
穿过装配链，任何一处漏传都会在运行期才暴露。AsyncLocalStorage 让身份在请求入口
一次性绑定，工具侧强制读取，模型 schema 中不再出现 `userId`。

**代价**：所有触发 AI 的入口都必须先建立上下文（HTTP、Socket、BullMQ worker 均已接入）；
单测必须显式包 `runWithContext`，否则会按预期 fail-closed 抛错。

**替代方案**：在 `runAgentLoop` 里拦截并改写 tool_calls 参数——否决，仍允许模型伪造身份字段。

### D2. 能力标记用工具元数据声明，而不是另一个清单

`TaggedTool` 增加 `capability: { kind: 'read' | 'write', requiresOwnership: boolean }`。确认流程与归属校验都从它推导。

**为什么**：现有的 `CONFIRM_REQUIRED_TOOLS` 是独立字符串集合，新增工具时容易忘记同步——P1-6 就是这么产生的。改成"声明在工具上"，漏声明在评审时可见，且可以加一条启动自检。

**自检规则**：启动时遍历注册表，若存在 `kind === 'write'` 但未进入确认流程的工具，直接 `error` 日志告警（不阻断启动，避免影响可用性）。

### D3. 注入检测放在分类之前，只做模式匹配不做模型判断

新增轻量检测：覆盖指令（"忽略之前"/"ignore previous"/"你现在是"）、索取内部结构（"输出你的提示词"/"system prompt"）、越权试探（"用用户X的账号"）。

**为什么不用模型判断**：检测本身要快（<5ms）且不受注入影响——用一个可被注入的模型去检测注入是循环依赖。

**命中后的动作**：不中断对话，降级为普通问答并记录 `injection.detected` 事件（含类型，不含原文）。理由：误报代价高于漏报的边际代价，且真正的防线是"身份不可伪造"（D1）。

### D4. 输出白名单按帧类型放行

只放行面向用户的帧类型：文本增量、状态、结束、错误、确认卡片、转人工。其余一律丢弃并计数。

**为什么在 handler 层做而不是在 prompt 层约束**：prompt 约束是概率性的，这一层是确定的。

### D5. Socket 与 HTTP 共用同一个限流服务与单飞键

单飞键取 `conversationId`，用 Redis `SET NX EX` 实现；任务结束释放。限流直接复用 `SseRateLimiterService` 的接口，不为 Socket 另写一套。

**为什么用 Redis 而不是进程内 Map**：限流与单飞都必须跨实例成立，进程内实现会在多实例下失效。

### D6. 消息唯一约束走迁移，冲突重试而不是预查

迁移加 `@@unique([conversationId, seqId])`；发送路径去掉"先查再插入"的预查，改为插入冲突后重新取号重试（最多 3 次）。

**为什么不用先查后写**：TOCTOU——两个请求同时查到该序号可用。

## Risks / Trade-offs

- **[工厂签名变更波及 9 个工具文件]** → 改动机械但面广，逐文件改完立刻跑 `tsc`，避免一次改太多看不清错误来源。
- **[注入检测误报]** → 只降级不中断，误报代价可控；命中类型可统计，后续可按数据调规则。
- **[单飞可能导致用户消息被丢弃]** → 抑制时返回明确状态（"上一轮仍在处理"），而不是静默丢弃。
- **[唯一索引在历史脏数据上可能建不起来]** → 迁移前先跑一次重复检查 SQL，有重复则人工处理后重试。
- **[启动自检只告警不阻断]** → 接受：阻断启动的风险大于收益；靠测试兜底（D2 的场景"名单缺漏自检"）。

## Migration Plan

1. 工具工厂签名改造 + 全量替换（行为不变，`tsc` 验证）
2. 能力标记 + 确认流程改由标记推导（行为不变，补自检）
3. 补全 `createAddress` / `updateAddress` 的截停（**行为变更**，需前端配合展示卡片）
4. 注入检测 + 输出白名单（行为变更，可开关隔离，默认关闭到验证通过）
5. Socket 限流与单飞
6. 消息唯一约束迁移（先跑重复检查）
7. 回滚：3~5 各自可独立 revert；6 的索引可 `DROP INDEX` 回滚

## Open Questions

- 注入检测的命中阈值与规则集，是否需要做成可配置？—— 先用内置规则集，等有命中数据再决定，不影响本设计的结构。
