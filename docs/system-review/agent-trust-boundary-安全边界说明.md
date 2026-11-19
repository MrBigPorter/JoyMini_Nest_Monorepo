# AI 客服信任边界说明（agent-trust-boundary）

> 日期：2026-11-19
> 范围：`apps/api` 的 AI 客服链路（HTTP SSE / Socket 触发 / BullMQ 队列）
> 依据：`openspec/changes/agent-trust-boundary/design.md` D1–D6、`tasks.md`、以及当前代码
> 性质：**安全边界的事实说明**，不是 OWASP LLM Top-10 全量评估，也不覆盖 admin 后台与资金结算业务本身。

---

## 1. 一句话结论

系统把「操作主体必须是当前登录用户」和「写操作必须经用户确认」这两件事，
从**模型可影响的参数**挪到了**调用链与工具声明**上：身份来自请求上下文，
确认由工具能力标记推导，数据库对消息序号兜底。注入检测和输出白名单是
**降低风险**的第二道闸门，不是身份安全的前提。

---

## 2. 信任模型：哪些输入不可信

| 输入 | 为什么不可信 | 当前处理 |
|---|---|---|
| 用户消息文本 | 用户可输入任意内容，可能包含注入指令 | 注入检测（默认关闭）；真正的防线是身份不可伪造 |
| 模型输出 / `tool_calls` 参数 | 模型可能被 prompt 注入影响，伪造字段 | 工具 schema 中不再有 `userId`；身份从上下文读取；写工具先截停确认 |
| 客户端传入的 `conversationId` / `addressId` / `ticketId` 等目标 ID | 可能指向他人数据 | 成员校验 + `requiresOwnership` 工具执行前归属校验 |
| Socket payload | 客户端可构造任意事件与字段 | 成员校验、JWT 身份、限流；不信任 payload 里的身份 |
| SSE 事件转发内容 | 内部决策 JSON 若直接出网会泄露 prompt/工具参数/候选分数 | 帧类型白名单 + step 帧字段白名单 |
| Redis / 下游基础设施状态 | 可能不可用或延迟 | 限流器熔断 fail-open；单飞在 Redis 故障时降级为进程内串行 |

**不作为信任来源**：模型传入的 `userId`、客户端传入的 `userId`、进程内全局变量、启动时绑定的固定用户。

---

## 3. 已收口的路径

### 3.1 身份闭包注入（D1）

- `common/logger/trace-context.ts` 提供 `runWithContext({ userId })`，用 `AsyncLocalStorage` 绑定请求级身份；`getRequestUserId()` 读取。
- `graph/tools/tool-identity.ts#requireToolUserId(toolName)` 是工具侧唯一入口：没有上下文时返回 `null`，调用方必须以 `MISSING_USER_CONTEXT` **fail-closed**，绝不回退到模型参数。
- 所有需要用户身份的工具模块（coupon / kyc / lucky / order / product / user / wallet）都调用 `requireToolUserId`；工具 schema 中不再有 `userId` 字段。
- 入口收敛：HTTP SSE（`ai-customer.service.ts#runEventStream`）、Socket/队列（`ai-processing.processor` → `ai-message.listener` → `chatStream`）、`testChat` 最终都经 `ai-stream.handler.ts#handleEventStream` 的 `runWithContext` 建上下文。

验证：

```bash
grep -rn "userId: z.string()" apps/api/src/client/ai-customer/graph/tools/   # 无输出
yarn workspace @lucky/api test -- wallet-tools user-tools lucky-tools order-tools coupon-tools kyc-tools product-tools
```

单测断言「模型伪造的 userId 被忽略」「无上下文时 fail-closed 且不调用业务服务」。

### 3.2 能力标记与确认流程（D2）

- `TaggedTool.capability = { kind: 'read' | 'write', requiresOwnership: boolean }`；缺省视为只读。
- 当前显式声明为 `write` 的 7 个工具：`claimCoupon`、`redeemCouponCode`、`applyWithdraw`、`draw`、`createAddress`、`updateAddress`、`deleteAddress`。
- 是否确认不再维护独立字符串清单（`CONFIRM_REQUIRED_TOOLS` 已删除），唯一判据是 `ToolRegistryService.requiresConfirmation()`（`capability.kind === 'write'`）。
- `orchestrator.node.ts` 在工具**执行前**用 `result.pendingToolCall` 判断：凡是写工具就生成 `pendingConfirm` 并停止流水线，等待用户确认；因此 `createAddress` / `updateAddress` 不再直通。
- 启动时 `AiCustomerModule` 调用 `toolRegistry.auditCapabilities()`，打印所有写工具；未声明能力的工具按只读处理并 `warn`。

验证：

```bash
grep -rn "CONFIRM_REQUIRED_TOOLS" apps/api/src        # 无输出
grep -rn "capability: { kind: 'write'" apps/api/src/client/ai-customer/graph/tools   # 7 条
yarn workspace @lucky/api test -- tool-registry.service
```

**已知缺口**：启动自检只对「缺少能力声明」发 `warn`，不会 `error`；如果新增写工具忘记标 `write`，会被当作只读并跳过确认（tasks.md 2.5 仍未完成）。

### 3.3 写工具归属校验（2.6）

`requiresOwnership: true` 的工具在执行前校验目标归属：

| 工具 | 校验方式 | 拒绝形态 |
|---|---|---|
| `draw` | 校验 ticket 属于当前用户 | 结构化失败 + `tool.denied{reason:'not_owned'}` |
| `updateAddress` | `addressService.detail(userId, addressId)` | `FORBIDDEN: address not found or not owned` + `tool.denied` |
| `deleteAddress` | 同上 | 同上 |

`applyWithdraw` / `claimCoupon` / `redeemCouponCode` / `createAddress` 的 `requiresOwnership=false`：
它们的操作对象是「当前用户自己的余额/券/新地址」，不存在可被指向他人的目标 ID；身份仍来自上下文。

验证：

```bash
yarn workspace @lucky/api test -- user-tools lucky-tools
```

### 3.4 输入注入检测（D3）

- `injection-detector.ts` 三类模式：`prompt_override`（忽略/覆盖系统指令）、`internal_probe`（索取提示词/工具清单/密钥）、`privilege_probe`（冒充管理员越权）。
- 在 `intent-router.node.ts` **分类之前**调用；命中后不中断对话，降级为 `intent: 'general'`，并记 `injection.detected{type, length}`（不含原文）。
- 开关 `AI_INJECTION_DETECTION_ENABLED`：默认关闭，只有字符串 `'true'` 才启用。

验证：

```bash
yarn workspace @lucky/api test -- injection-detector
```

### 3.5 输出帧白名单（D4）

- `ai-stream-frames.ts` 只允许 5 类帧：`token` / `step` / `done` / `error` / `transfer`。
- `sanitizeStepFrame` 只保留 `step`、`content`、`tool` 三个字段；`args`、`decision`、`prompt`、`scores` 等内部字段一律丢弃。
- 两处 SSE 出口（`GET /chat/stream/:streamId` 与已废弃的 `POST /chat-stream`）的 `sendSSE` 都经过白名单（开关开启时，默认开启）；非白名单类型丢弃并记 `Dropped non-whitelisted SSE frame`。
- 开关 `AI_STREAM_FRAME_WHITELIST_ENABLED`：**默认开启**，仅显式字符串 `'false'` 关闭（拼写错误如 `'0'`/`'FALSE'` 仍视为开启）。

验证：

```bash
yarn workspace @lucky/api test -- ai-stream-frames
```

### 3.6 限流与同会话单飞（D5）

**HTTP SSE**：`SseRateLimiterService` 提供多层限制（用户独占、全局并发、IP/设备、令牌桶），用于 `POST /chat`、`GET /chat/stream/:streamId`、旧版 `POST /chat-stream`。

**Socket 触发 AI**：`events.gateway.ts#send_message` 在消息落库后、`aiQueue.enqueue` 之前调用 `tryAcquireLight(userId)`，与 HTTP `POST /chat` 共用同一个 Redis 令牌桶 key（`sse:token:${userId}:init`，1 次/秒、突发 6）。超限只抑制本轮 AI，消息本身已落库，响应带 `aiTriggered: false`。普通人工/客服会话不走这段限流。

**同会话单飞**：`AiMessageListener` 两层：
1. 进程内按 `conversationId` 的 Promise 队列，严格串行、保序；
2. Redis 分布式锁 `ai:conv:${conversationId}`，`SET NX PX 120000`，`finally` 中用 Lua「比对 value 再删」释放。

抢锁失败时有界重试（200ms 间隔，最多等 30s）；超时记 `reason=lock_timeout` 的 `warn` 后放弃本轮。Redis 锁本身不可用时降级为「仅进程内串行」，不丢消息。

验证：

```bash
yarn workspace @lucky/api test -- ai-message.listener
yarn workspace @lucky/api test -- events.gateway.ai-rate-limit
yarn workspace @lucky/api test -- sse-rate-limiter.service
```

`events.gateway.ai-rate-limit.spec.ts` 覆盖：未超阈值放行并入队、超阈值不入队/不发事件（无模型调用）且返回结构化状态、人工会话不受影响、限流器异常 fail-open。
`sse-rate-limiter.service.spec.ts` 覆盖：同一主体前 6 次放行第 7 次拒绝、不同主体独立计数、1 秒后补 1 个令牌。

### 3.7 消息序号唯一（D6）

- Prisma schema：`ChatMessage @@unique([conversationId, seqId], map: "idx_chat_message_conv_seq")`。
- 迁移：`apps/api/prisma/migrations/20261119170000_chat_message_seq_unique/migration.sql`（先 drop 普通索引，再建唯一索引）。
- 发送路径（`chat.service.ts#sendMessage` 与 `events.gateway.ts#send_message`）在事务内 `conversation.update({ lastMsgSeqId: { increment: 1 } })`，再把该值写入 `seqId`；并发由会话行的写锁串行化，唯一索引作为数据库层兜底。

验证：

```bash
grep -n "idx_chat_message_conv_seq" apps/api/prisma/schema.prisma
cat apps/api/prisma/migrations/20261119170000_chat_message_seq_unique/migration.sql
psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE indexname='idx_chat_message_conv_seq';"
```

---

## 4. 仍开放的路径与残余风险

| # | 风险 | 现状 / 影响 | 建议 |
|---|---|---|---|
| R1 | 注入检测默认关闭 | 默认部署下 `injection.detected` 不会产生；只有显式设 `AI_INJECTION_DETECTION_ENABLED=true` 才生效 | 先观察误报再打开；不要把检测当作身份防线 |
| R2 | 检测只做正则匹配 | 改写措辞、编码、间接引用可绕过；不扫描 RAG 检索到的知识文档与工具输出 | 需要时增加知识库/工具输出侧的来源标记与人工审核 |
| R3 | 缺少能力声明的新写工具会被当成只读 | `auditCapabilities` 只 `warn`，不阻断启动 | tasks.md 2.5：对「write 但未进确认」改为 `error`，并加启动自检用例 |
| R4 | 确认截停依赖 orchestrator 路径 | 若未来出现绕过 orchestrator 直接调用写工具的入口，确认不会自动生效 | 新增入口必须复用 `requiresConfirmation` 或工具层强制确认 |
| R5 | 归属校验只覆盖 3 个有目标 ID 的工具 | 其他写工具靠「操作对象天然属于当前用户」；没有数据库行级安全（RLS） | 新增可指向他人资源的工具时必须声明 `requiresOwnership` |
| R6 | 单飞锁 TTL 120s 且不续期 | 单轮超过 120s 时锁提前释放，跨实例互斥失效 | 长任务需要续期或把 TTL 调到观测到的上界 |
| R7 | 单飞超时对用户不可见 | 有界等待 30s 后只记 `warn` 并放弃本轮；用户消息已落库但没有 AI 回复 | 与 design D5 的「返回上一轮处理中」不一致，可在 ack 中补状态 |
| R8 | Redis 故障时限流/单飞 fail-open | 限流器熔断会放行；单飞降级为进程内串行，多实例下可能并跑 | 接受可用性优先；多实例强一致需要额外协调机制 |
| R9 | 消息序号并发用例缺失 | 唯一索引已在 DB 层兜底，但没有 API 级并发回归（tasks.md 5.4） | 补两条几乎同时发送的集成用例 |
| R10 | `done` 帧仍携带 `sources` | 只含检索来源摘要，不含 prompt/候选分数；属于产品需要的数据 | 保持来源结构受控，避免把内部文档全文塞进 `sources` |

---

## 5. 开关与默认值

| 开关 | 默认 | 语义 | 代码位置 |
|---|---|---|---|
| `AI_INJECTION_DETECTION_ENABLED` | 关闭 | 只有 `'true'` 启用注入检测；其余值（含未设置、`'1'`）均关闭 | `injection-detector.ts#isInjectionDetectionEnabled` |
| `AI_STREAM_FRAME_WHITELIST_ENABLED` | **开启** | 只有显式 `'false'` 关闭；关闭后帧类型不拦截，step 帧按 `{ step, ...data }` 原样透传 | `ai-stream-frames.ts#isStreamFrameWhitelistEnabled` |

非环境变量的固定参数：

| 参数 | 值 | 位置 |
|---|---|---|
| 单飞锁 TTL | 120s | `ai-message.listener.ts#LOCK_TTL_MS` |
| 抢锁最大等待 | 30s | `ai-message.listener.ts#LOCK_MAX_WAIT_MS` |
| 抢锁重试间隔 | 200ms | `ai-message.listener.ts#LOCK_RETRY_DELAY_MS` |
| 令牌桶速率 / 突发 | 1 次/秒 / 6 | `sse-rate-limiter.service.ts` |

> 注意：这两个环境开关的默认值由代码决定；部署环境如需开启注入检测，必须显式注入 `AI_INJECTION_DETECTION_ENABLED=true`（未设置即关闭）。

---

## 6. 验证命令汇总

```bash
# 类型
yarn workspace @lucky/api check-types

# 信任边界相关单测
yarn workspace @lucky/api test -- injection-detector
yarn workspace @lucky/api test -- ai-stream-frames
yarn workspace @lucky/api test -- ai-message.listener
yarn workspace @lucky/api test -- events.gateway.ai-rate-limit
yarn workspace @lucky/api test -- sse-rate-limiter.service
yarn workspace @lucky/api test -- tool-registry.service
yarn workspace @lucky/api test -- wallet-tools user-tools lucky-tools order-tools coupon-tools kyc-tools product-tools

# 静态检查
grep -rn "userId: z.string()" apps/api/src/client/ai-customer/graph/tools/   # 期望无输出
grep -rn "CONFIRM_REQUIRED_TOOLS" apps/api/src                               # 期望无输出
grep -rn "capability: { kind: 'write'" apps/api/src/client/ai-customer/graph/tools  # 期望 7 条
```

---

## 7. 与 design / tasks 的口径差异（只记录，不改代码）

| 项 | tasks/design 的写法 | 代码现状 |
|---|---|---|
| 3.3 位置 | 「`ai-stream.handler.ts` 增加帧类型白名单」 | 实际在 `ai-stream-frames.ts` + `ai-customer.controller.ts` 的 `sendSSE`；`ai-stream.handler.ts` 仍只负责事件流与回调转发 |
| 3.4 默认值 | 「开关默认关闭到验证通过」 | 帧白名单开关**默认开启**，仅 `'false'` 关闭（避免上线后重新暴露内部字段）；注入检测开关默认关闭 |
| 4.2 并发反馈 | 「第二次收到『上一轮处理中』」 | 实际是 30s 有界等待；超时后记 `warn` 并放弃本轮，没有用户可见的状态 |
| 5.3 取号方式 | 「去掉先查再插入的预查，改为冲突后重试取号（最多 3 次）」 | 发送路径原本就是「事务内递增 `lastMsgSeqId` + 插入」，没有预查可删；当前也没有重试循环，靠行锁串行 + 唯一索引兜底 |
| 2.4 验证 | 「新增两条用例断言未确认前不调用 service」 | 已有 `tool-registry.service.spec.ts` 断言 `createAddress` 需要确认；但没有直接断言「未确认时 service 未被调用」的用例 |
| 2.5 启动自检 | 「write 但未纳入确认流程时打 `error`」 | `auditCapabilities` 会列出写工具，并对**缺少能力声明**的工具发 `warn`；由于确认流程直接由 `write` 推导，不存在独立的「write 但排除确认」集合，因此也没有对应的 `error` 分支 |
| 4.1 状态 | tasks.md 已勾选（4.1） | 工作区已接入 Socket 入口限流（`events.gateway.ts#checkAiTriggerRateLimit`），与 HTTP 共用令牌桶，并补了 `events.gateway.ai-rate-limit.spec.ts` / `sse-rate-limiter.service.spec.ts`；该改动在本文档生成时**尚未提交** |

> 本文档生成时，工作区还有 `frame-whitelist-flag` / `socket-rate-limit` 两条并行改动未提交；
> 若后续实现与上表不同，以提交后的代码为准。
