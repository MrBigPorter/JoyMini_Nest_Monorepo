# AI 客服全流程审计（2026-11-22）

> 范围：`apps/api/src/client/ai-customer/` 及与之耦合的 `common/chat`、`common/ai`、`admin/chat`、Flutter 确认卡片。
> 方法：代码通读 + 生产会话回放（`cmrj13rnm0008p83dwk5it651`）+ PG checkpoint / `ai_action_requests` / Redis 实际状态核对。
> 结论先行：**确认流程的业务契约本身是清楚的**（`openspec/changes/ai-action-card-contract/specs/ai-customer/action-confirmation/spec.md`）；问题不在契约，而在**实现把「模型可见状态」「执行权威状态」「展示状态」拆成了四份互不校验的存储**，并且**工具结果从不进入下一轮上下文**。

---

## 1. 流程清单

| # | 入口 | 链路 | 判定 |
|---|---|---|---|
| A | Socket/消息事件（生产主路径） | `ChatService` 事务写 `ChatMessage` + `ai_task_outbox` → outbox 5s relay → BullMQ → `AiProcessingProcessor` → `AiMessageListener`（进程内队列 + Redis `ai:conv:{id}` 单飞）→ `chatStream` | ✅ 主路径，单飞与重试设计合理 |
| B | HTTP 两阶段 SSE | `POST /ai/customer/chat` 预留 → `GET /chat/stream/:streamId` → `chatStream` | ✅ 可用；与 A 共用同一执行体 |
| C | Legacy SSE | `POST /ai/customer/chat-stream` → `chatStream`，但**未传 `onTransfer`** | ⚠️ 转人工不会到达 SSE 客户端（[ai-customer.controller.ts:425-442](../../apps/api/src/client/ai-customer/ai-customer.controller.ts#L425-L442)） |
| D | Debug/test | `POST /ai/customer/test-chat` → `graph.invoke`，绕过 gate/配额/卡片过期/lifecycle/outbox | ⚠️ 只应存在于非生产；需确认路由守卫 |
| E | 死监听 | `@OnEvent(AI_MESSAGE_REQUESTED)` 在 `src` 内无 emitter | ⚠️ 第二套不可达的 AI 调用机制（[ai-message.listener.ts:86](../../apps/api/src/client/ai-customer/ai-message.listener.ts#L86)） |
| F | 确认卡片 | orchestrator 截停写工具 → `pendingConfirm` → `routeConfirm`（DB 行 + Redis 60s 令牌 + 私有房 `AI_CONFIRM` + 卡片消息）→ `/confirm`、`/confirm/cancel`、`/confirm/otp/resend`、`/confirm/otp` | ⚠️ 契约清楚，实现分叉（见 §2、§3） |
| G | 定时任务 | 卡片过期 cron 每分钟；outbox relay 每 5 秒 | ✅ |

---

## 2. 确认流程的四套状态存储

同一次「待确认动作」被同时记录在四个地方，**没有任何一处是唯一权威**：

| 存储 | 写什么 | 谁能改 | 会与谁分叉 |
|---|---|---|---|
| Graph state `pendingConfirm` | action + params + summary | orchestrator（模型轮次） | 新消息、handoff reset、rollback |
| Redis `ai:confirm:{token}` | action + params + summary + userId + requestId | `routeConfirm` 生成；`/confirm` 消费 | DB 已 EXPIRED 后令牌仍可执行 |
| Redis `ai:confirm:pending:{userId}` | 提现待 OTP 执行的参数 | `startWithdrawOtp` 暂存 | 同用户第二笔覆盖第一笔；缺 `conversationId` |
| DB `ai_action_requests` | 生命周期与审计 | `AiActionLifecycleService` | 不是执行判据，只是记录 |

**后果**：UI/DB 说「已过期」，令牌说「还能执行」；模型说「待确认」，DB 说「已作废」；审计说「CONFIRM」，实际没有卡片。

---

## 3. 漏洞清单（按严重度）

### Critical

1. **模型可以发布「已完成」而没有任何执行证据**
   `routeNormalCompletion` 原样发布最后一条 AI 文本（[ai-customer.service.ts:1107-1125](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1107-L1125)、[2155-2176](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L2155-L2176)）。发布前只有「敏感信息」改写（[1033-1054](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1033-L1054)），没有「成功声明必须对应 EXECUTED 动作 / 成功工具调用」的校验。
   实测：15:48 两条「提现申请已提交」，0 tool span、0 action request、0 OTP、`frozen_balance=0`。

2. **DB 过期不阻止执行**
   `/confirm` 只消费 Redis 令牌（[ai-customer.service.ts:1786-1791](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1786-L1791)），不检查 `ai_action_requests.status`。`expireForConversation` 把 DB 置 `EXPIRED`（[ai-action-lifecycle.service.ts:112-135](../../apps/api/src/client/ai-customer/ai-action-lifecycle.service.ts#L112-L135)）后，令牌在 60s 内仍可执行。
   同一问题的反向：cron 标 `EXPIRED`，Redis 令牌未必过期。

3. **提现渠道未校验类型**
   `applyWithdraw` 只查 `id + status`（[client-wallet.service.ts:441-446](../../apps/api/src/client/wallet/client-wallet.service.ts#L441-L446)），充值渠道 `type=1` 也能提现。实测模型传 `channelId=1`（PH_GCASH 充值渠道），卡片按零手续费展示。

4. **提现 OTP 成功后结果丢失**
   `startWithdrawOtp` 暂存 payload 时**不带 `conversationId`**（[ai-customer.service.ts:2046-2052](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L2046-L2052)），`emitActionResult` 在缺 `conversationId` 时直接 return（[1909-1914](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1909-L1914)）。用户输完 OTP 后既收不到 `AI_ACTION_RESULT`，会话里也没有结果消息。

5. **`requestWithdrawOtp` / `verifyWithdrawOtp` 声明为 read，却有真实副作用**
   [wallet-tools.ts:215](../../apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts#L215)、[274](../../apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts#L274)。模型可在没有卡片确认的情况下发短信、核销验证码。

### High

6. **工具结果不进入下一轮上下文**
   `runAgentLoop` 的 `currentMessages` 是局部变量（[agent-runner.ts:198-262](../../apps/api/src/client/ai-customer/graph/agents/agent-runner.ts#L198-L262)），orchestrator 只取 `result.content`，确认分支只写 `AIMessage('Please confirm the details.')`（[orchestrator.node.ts:761-777](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts#L761-L777)）。
   PG checkpoint 里这条会话的 `messages` 通道只有 Human/AI 文本，`tool_calls: []`，**无一条 ToolMessage**。
   这直接导致：couponId 变 `"2"`、channelId 变 `1`、模型编造「已提交」。

7. **`pendingConfirm` 能力已实现但未接线**
   `runStandardAgent` 接受并注入 `pendingConfirm`（[agent-factory.ts:96,195](../../apps/api/src/client/ai-customer/graph/nodes/agent-factory.ts#L96-L195)），orchestrator 调用处没传（[orchestrator.node.ts:661-673](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts#L661-L673)）。

8. **短确认语绕过所有会话状态**
   embedding 分类只要 `method !== llm_fallback` 就不看 `previousIntent`/`flowState`（[intent-router.node.ts:242-260](../../apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts#L242-L260)）。「确认」命中 `kyc` 后跑 kyc agent，没有钱包工具，monkey 编造结果。
   实测 15:46、15:48 三连 trace `intent=kyc`。

9. **每条新消息先作废所有待确认卡片**
   [ai-customer.service.ts:608-616](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L608-L616)。用户打「确认」这个动作本身让卡片 `EXPIRED`，然后才进入分类；文字确认在现架构下永远不可能成功。

10. **会话配额对长期用户永不重置**
    key 按会话（[ai-usage.service.ts:153-155](../../apps/api/src/client/ai-customer/ai-usage.service.ts#L153-L155)），每条消息 `INCRBY` 后 `EXPIRE 24h`（[185-189](../../apps/api/src/client/ai-customer/ai-usage.service.ts#L185-L189)）；会话又是永久的（`ai_chat:{userId}`，[ai-memory.service.ts:82-99](../../apps/api/src/common/ai/ai-memory.service.ts#L82-L99)）。每天使用一次的用户，计数器永不过期。

11. **流程状态由模型自觉填写**
    `updateFlowData` / `updateFlowStatus` 是未登记的 read 工具（[flow-tools.ts:47,101](../../apps/api/src/client/ai-customer/graph/tools/flow-tools.ts#L47-L101)），却驱动 `flowState` 与确认收尾。模型不调用，流程就停在旧状态（实测 15:44 仍是 `BALANCE_QUERY/COMPLETED`）。

12. **`ask` 分支丢上下文**
    多意图 `action === 'ask'` 返回时没有带 `contextState`（[orchestrator.node.ts:498-511](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts#L498-L511)），实体/纠正信息丢失。

### Medium

13. **四套状态存储互不校验**（§2）——任何一处更新失败都能让其余三处继续按旧状态工作。
14. **`emitActionResult` 依赖 payload 里的 `conversationId`**，取消/重发路径同样受影响（[ai-customer.service.ts:1841-1901](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1841-L1901)）。
15. **trace `status=CONFIRM` 不代表卡片创建成功**：`confirmCard = Boolean(finalState.pendingConfirm)`（[ai-customer.service.ts:1072-1093](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1072-L1093)）；`routeConfirm` 因守卫提前 return 时仍记 CONFIRM。
16. **handoff reset 只清 graph state**（[ai-customer.service.ts:817-830](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L817-L830)），不清 DB 行与 Redis 令牌。
17. **gate 拦截路径在 `expireForConversation` 之前 return**（[555-564](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L555-L564) vs [608](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L608)），转人工期间卡片保持 live。
18. **两套 quota、两套 handoff、两套 SSE** 可以给出不同结论（§1、§2）。
19. **卡片 `summary` 未脱敏**：展示字段 `fields` 已掩码，但兼容字段 `summary` 仍是完整账号（[action-catalog.ts:152-159](../../apps/api/src/client/ai-customer/graph/config/action-catalog.ts#L152-L159)），随 `AI_CONFIRM` 与聊天消息 `meta` 下发。
20. **`applyWithdraw` 工具 body 内部会真的提现**（[wallet-tools.ts:515-534](../../apps/api/src/client/ai-customer/graph/tools/wallet-tools.ts#L515-L534)）；当前靠「写工具必截停」保证不执行，一旦截停逻辑回归，工具本身就是第二个执行点。

### 确认链路攻击面（独立安全审计补充）

21. **【Critical】生产 OTP 是公开常量**：`compose.prod.yml` 使用 `OTP_PROVIDER=fixed` + `OTP_FIXED_CODE=999999` + `OTP_ALLOW_FIXED_IN_PROD=true`（[sms.provider.ts:44-46](../../apps/api/src/client/otp/sms.provider.ts#L44-L46)、[otp.service.ts:58-62](../../apps/api/src/client/otp/otp.service.ts#L58-L62)）。拿 JWT → 确认卡 → `/confirm/otp {code:"999999"}` 即可提现；`/otp/request` 甚至直接返回验证码。这是 `docs/current-task.md` T1-1 中**有意选择的演示配置**，上线前必须改为真实短信或一次性测试码。
22. **【Critical】handoff 不撤销确认/待执行任务**：`markTransferred` 没有任何调用方（[ai-action-lifecycle.service.ts:98-106](../../apps/api/src/client/ai-customer/ai-action-lifecycle.service.ts#L98-L106)）；`routeTransfer` 不清理 Redis token/pending。转人工后攻击者/用户仍可完成仍在有效期的提现。
23. **【Critical】成员校验失败会把别人的会话打回人工**：成员校验只在 `prepareThread` 内（[ai-memory.service.ts:58-70](../../apps/api/src/common/ai/ai-memory.service.ts#L58-L70)）；抛出的 `NotFoundException` 被 `chatStream` 的错误分支接住（[ai-customer.service.ts:714-768](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L714-L768)），随后 `policyFallback`/`degradeToHuman` 用攻击者传入的 `conversationId` 写消息、置 `awaiting_human`。认证用户可以用任意 cuid 把别人的 AI 会话踢出 AI 模式。
24. **【Critical】`buildParams` 是死代码，执行参数直接来自模型原始 args**：`routeConfirm` 用 `pc.params` 建行/发令牌（[ai-customer.service.ts:1671-1709](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1671-L1709)），目录里的白名单从没执行。提示注入可以夹带额外字段；提现会在很晚的 DTO 校验处失败（DoS），其他动作则把多余字段带进令牌与 DB。
25. **【High】完整收款账号越权可见**：`buildSummary` 返回未掩码的 `account`/`accountName`（[action-catalog.ts:152-159](../../apps/api/src/client/ai-customer/graph/config/action-catalog.ts#L152-L159)），随 `AI_CONFIRM`、`AiActionRequest.summary` 与聊天消息 `meta` 下发；`ai-reply-publisher` 把 `meta` 推给**所有会话成员**（[ai-reply-publisher.ts:131-149](../../apps/api/src/client/ai-customer/ai-reply-publisher.ts#L131-L149)）。
26. **【Medium】确认令牌明文进日志**：失败/他人尝试时打印 `Token ${token}`（[ai-action-confirm.service.ts:94](../../apps/api/src/client/ai-customer/ai-action-confirm.service.ts#L94)），60 秒有效期的写凭证进入日志存储。
27. **【Medium】卡片/令牌签发无幂等键**：`createConfirm` 普通 create、令牌普通 set（[ai-action-lifecycle.service.ts:45](../../apps/api/src/client/ai-customer/ai-action-lifecycle.service.ts#L45)、[ai-action-confirm.service.ts:75](../../apps/api/src/client/ai-customer/ai-action-confirm.service.ts#L75)）。令牌生成与消息落库之间重试/崩溃会签出两个都能执行的令牌；`perUserLimit>1` 的券可被重复领取。
28. **【Medium】OTP 尝试次数按记录而不是按动作**：`verify` 只取最新一条 PENDING（[otp.service.ts:120-127](../../apps/api/src/client/otp/otp.service.ts#L120-L127)）；锁定后（138-144）还能落到更早的 PENDING，5 次上限被放大成 5N。
29. **【Medium】生命周期状态不是状态机**：`updateStatus` 无条件 `updateMany({where:{id}})`（[ai-action-lifecycle.service.ts:170-185](../../apps/api/src/client/ai-customer/ai-action-lifecycle.service.ts#L170-L185)），`EXPIRED` 可被 `EXECUTED` 覆盖，审计终态不可信。
30. **【Medium】取消不需要有效令牌**：`cancelAction` 在令牌无效时直接按 `userId` 弹出待执行任务（[ai-customer.service.ts:1854-1864](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1854-L1864)）；`stagePendingExecution` 普通 set，第二次确认覆盖第一笔。
31. **【Medium】改地址会清空姓名**：`executeUpdateAddress` 传 `undefined`（[ai-customer.service.ts:1987-2025](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1987-L2025)），`addressService.update` 写 `firstName: dto.firstName ?? null`（[address.service.ts:177-191](../../apps/api/src/client/address/address.service.ts#L177-L191)）。用户只说“改电话”会清掉 first/last name。
32. **【Medium】管理端调试接口原样返回 `pendingConfirm`**：包含完整提现参数（[ai-customer.service.ts:452](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L452)），`AiContextController` 只做角色校验，没有脱敏。
33. **【Low】自检正则与未知工具**：副作用命名正则不含 `update|set|bind|cancel`（[tool-registry.service.ts:199-211](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts#L199-L211)）；`requiresConfirmation('unknownTool')` 返回 false（144-146），测试却称其为 fail-closed——实际在拦截点上是 fail-open。
34. **【Low】目录外动作仍会发卡**：`routeConfirm` 对不在目录里的 action 照样建卡，确认时必然 `markFailed`，产生死卡（[ai-customer.service.ts:1794-1801](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L1794-L1801)）。

---

## 4. 流程判定（是否「走歪」）

| 流程 | 判定 | 偏差点 |
|---|---|---|
| 意图识别 | ⚠️ 部分走歪 | 纯 embedding top-1 + 分数门槛；短确认语、纠正、指代都不参与；`previousIntent` 只在 LLM fallback 中使用 |
| Agent 流水线 | ⚠️ 部分走歪 | 工具事实不落盘；`pendingConfirm` 不注入；flowState 由模型自觉维护 |
| 写操作确认 | ⚠️ 契约对、实现分叉 | 四套状态；DB/Redis 分叉；文字确认不可能；OTP 结果丢失 |
| 转人工 | ⚠️ 两条路径 | orchestrator transfer 与 `degradeToHuman` 各说各话；离线话术覆盖配额错误 |
| 配额 | ❌ 走歪 | 会话永久 + TTL 续期 = 长期用户永久锁死；配额错误伪装成「客服不在线」 |
| 可观测 | ⚠️ 部分 | trace 状态失真；tool span 有记录但没有与最终声明关联；`test-chat` 绕过全部闸门 |
| 记忆/上下文 | ✅ 设计合理 | 长期记忆白名单 + TTL；结构化 contextState 方向正确，但注入不全 |
| 安全边界 | ⚠️ 大体成立 | 身份来自请求上下文、写工具截停、令牌一次性；但 OTP 工具与 flow 工具声明为 read |

---

## 5. 市场对照

调研对象：Zendesk、Intercom Fin、Salesforce Agentforce、Shopify Sidekick、Gorgias、Tidio Lyro、Freshworks Freddy、Alibaba AliMe；JD 咚咚无公开架构资料。

| 系统 | 会话状态 | 写操作确认 | 转人工 | 幻觉防护 | 短回复处理 |
|---|---|---|---|---|---|
| [Zendesk](https://developer.zendesk.com/documentation/ai-agents/chat/event-type/) | 服务端 session + `platformConversationId` + 不活跃 TTL | 配置化 action 自动执行，**无公开确认闸门** | Switchboard `passControl`，工单可分配 | 兜底话术 + 来源链接 + 升级按钮 | Yes/No 按钮，不解析自然语言 |
| [Intercom Fin](https://developers.intercom.com/docs/guides/fin-agent-api) | `conversation_id` + 显式状态机 + 最近 10 条 | Procedures/connectors，**无确认原语** | `/fin/escalate`，携带最多 10k 字上下文 | 三阶段引擎：改写→生成→准确性校验，低置信度澄清/升级 | `awaiting_user_reply` 澄清，不解析 yes/no |
| [Salesforce Agentforce](https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-ref-actions.html) | Agent 变量 + action 输入/输出 | `require_user_confirmation` + `available_when`，以 Agent 自身身份执行仍校验授权 | `@utils.escalate` → Omni-Channel | 确认 + 守卫条件 | 平台确认提示，非 NL 解析 |
| [Shopify Sidekick](https://shopify.dev/docs/apps/build/sidekick) | Sidekick 会话，无状态 API | propose-then-approve：动作扩展把商家带到 UI 确认 | Inbox → Unassigned，携带 AI 上下文 | 写操作不可静默执行 | UI 确认 |
| [Gorgias](https://helpcenter.gorgias.com/en-US/create-an-action-for-ai-agent-567325) | 会话 + typed action 变量 + 订单/客户数据 | 确认开关，不可逆结果自动开启；条件 + HTTP action | Handover topics → tag/团队/队列；失败加 note 并转人工 | 答案绑定来源 + 二次模型置信度校验 | Shopper approval checkpoint |
| [Tidio Lyro](https://help.tidio.com/hc/en-us/articles/29683749336988-Lyro-Procedures) | Procedure 目标 + 联系人属性作为持久槽位 | 后台执行**或**请访客确认；MCP 工具 | 在线/离线矩阵：转接/保留/建单 | 无知识即转人工 | 未公开 |
| [Freshworks Freddy](https://support.freshservice.com/support/solutions/articles/50000014452-perform-actions-with-copilot-agent) | 工单/会话；转人工前最多收集 5 个属性 | 三态：Always allowed / Approval required / **Blocked**，新动作默认安全态 | 建单 + 触发器（低置信、轮次上限、敏感话题、离线） | 审批 + 权限 | Approve/Ignore 卡片 |
| [Alibaba AliMe](https://www.alibabacloud.com/blog/alibaba-cloud-customer-service-agent-thoughts-design-and-practices-from-concept-to-implementation_601555) | 长短期记忆 + 槽位 + 前序意图；**API observation 回填 Thought** | 参数校验；辅助模式人工确认；无通用闸门 | 检索失败按意图转人工 | API 参数校验 + 拒绝训练 + 离线评测 | 追问槽位 |

### 行业收敛出的 8 条原则

1. **状态在服务端，按会话 ID 存，transcript 不是事实来源**（Zendesk session、Intercom 状态机、Tidio 联系人属性）。
2. **工具结果必须作为结构化 observation 回填模型；模型的散文不是记录**（AliMe 明确把 API observation 送回 Thought）。
3. **副作用由声明式标志 + 服务端授权控制，不靠提示词**（Salesforce `require_user_confirmation`、Gorgias 不可逆自动确认、Freshworks 三态、Shopify propose-then-approve）。
4. **确认是结构化 UI/状态机事件，不是自由文本 NLU**：Freshworks 用 Approve/Ignore 卡片，Shopify 在 App UI 确认，Zendesk 用按钮；**没有公开设计去用意图分类器解析「好/可以」**。
5. **权威状态在业务系统；AI 只编排，结果要回读或对账**（Gorgias 把 action 输出映射回变量，失败加 note 转人工）。
6. **发送前做 grounding/验证；低置信度澄清或转人工**（Fin 三阶段、Gorgias 二次模型）。
7. **转人工是显式状态迁移 + 上下文交接 + 队列/工单**，不是一句「客服不在线」（Zendesk passControl、Intercom 10k 上下文、Shopify Unassigned）。
8. **配额是平台速率/套餐上限，不是每用户每日预算**；重置窗口显式（Intercom 10 秒窗口、Gorgias leaky bucket、Shopify 工具/令牌上限）。业务限额（退款金额、订阅时长）放在 action 条件层。

### 本项目应抄 / 应避

| 主题 | 抄 | 避 |
|---|---|---|
| 状态 | 结构化槽位 + 工具结果回填；`pending_action` 表带 `params_hash`、`idempotency_key` | 用 transcript 重建状态；模型文本充当执行记录 |
| 确认 | 动作目录带 `requires_confirmation`/风险级别；令牌绑定 `user + conversation + action + params_hash` | 提示词「先问再退款」；模型自己写成功消息；确认不绑定展示参数 |
| 短回复 | 分类前确定性分支：有 pending action → yes/no/其他三分；其他则重述动作与参数 | 把「好」送进 9 意图分类；多个 pending 时猜一个 |
| 幻觉 | 每个成功声明必须映射到带 `action_id` 的工具结果，否则回答「未执行」 | 让模型根据计划断言副作用 |
| 转人工 | 显式 handoff 节点：写摘要/槽位/pending action，置 escalated，AI 停止动作 | 静默转接；转接后 AI 仍可行动；pending 丢失 |
| 配额 | 传输层（用户/会话/分钟/天）+ 业务层（单笔/每日退款额） | 一个全局计数器；按会话且客户端重连就重置；把确认算成新请求 |
| 可观测 | 每轮 `conversation_id/turn_id/action_id/intent/route/slots/tool calls/state transitions` | 只有聊天文本，没有工具与状态迁移 |

---

## 6. 修复优先级

**P0（资金/越权，先修）**

1. **执行权威统一**：以 `ai_action_requests` 为唯一权威，`/confirm`、`/confirm/otp` 都先做 DB CAS（`CONFIRM_CREATED → CONFIRMED → EXECUTED`）；令牌只是第二把钥匙。
2. **转人工撤销**：`routeTransfer` 调 `markTransferred`；handoff reset / gate 拦截作废 DB 卡片；待 OTP 任务随之失效。
3. **成员校验失败不得写库**：`prepareThread` 的 `NotFoundException` 直接返回，不走 fallback/degrade。
4. **白名单执行参数**：`issueConfirmCard` 使用 `catalogEntry.buildParams`，原始模型 args 不进入令牌/DB。
5. **提现渠道类型**：`applyWithdraw`/`applyWithdrawVerified` 校验 `channel.type === 2`。
6. **生产 OTP**：固定码是产品决策，上线前必须替换（本计划不擅自改）。

**P1（可信度）**

7. **状态连续性**：工具事实（ID/金额/费率/渠道名）确定性写入 `contextState.slots`；每轮注入最近动作状态。
8. **短确认路由**：确认语优先绑定最近的 action，不进入 embedding 分类；过期则确定性回复。
9. **事实闸门**：无 EXECUTED 动作/成功工具调用时，禁止发布完成语。
10. **卡片展示**：渠道名/手续费/到账；`summary` 脱敏后再下发。
11. **OTP 完整性**：pending 带 `conversationId`、单 pending、OTP 结果事件可送达。
12. **能力声明**：OTP/flow 工具声明 `internal`；自检正则补齐；未知工具 fail-closed。

**P2（工程卫生）**

13. **配额与错误语义**：按自然日计数；配额耗尽单独话术。
14. **可观测**：trace 状态区分「发卡成功/被拒」；转人工、gate、debug 快照脱敏。
15. **清理重复机制**：legacy SSE / 死监听 / `test-chat` 生产隔离。
16. **令牌日志与幂等**：日志只留前缀；同消息同动作复用卡片。

**需要产品决策**

- 生产 OTP 固定码（T1-1 有意配置）。
- 取消接口的 `requestId` 校验需要 Flutter 同步改动。
- `ai_action_requests` 是否补唯一约束/FK（需迁移）。

## 7. 修复状态（2026-11-23）

> 计划：[2026-11-23-ai-customer-trustworthy-execution](../superpowers/plans/2026-11-23-ai-customer-trustworthy-execution.md)。T1–T11 已实现并提交在 `feat/ai-ops-operator-console`。

| 发现 | 状态 | 落地 |
|---|---|---|
| A-1 币种 ₱/¥ | ✅ 已修 | `ClaimableCouponResponseDto.currency` + 工具填 PHP + coupon prompt 强制 ₱（T8） |
| A-2 序号当 couponId | ✅ 部分修复 | 工具事实落盘后模型能拿到真实 ID（T3）；守卫保留，用于真正的不存在 ID |
| A-3 trace 假 CONFIRM | ✅ 已修 | `resolveTurnStatus`：卡片未创建记 `CONFIRM_REJECTED`（T11） |
| A-4 手续费漏费率 | ✅ 已修 | DTO 暴露 `feeRate`；卡片展示渠道名/手续费/到账（T8） |
| A-5 配额误报客服离线 | ✅ 已修 | `QUOTA_EXCEEDED_REPLY`，配额错误不再走 `degradeToHuman`（T10） |
| A-6 配额永不重置 | ✅ 已修 | 会话配额改为 `conversationId + Asia/Manila 日期` 桶（T10） |
| A-7 双重确认 | ⏸ 未改 | 仍为「文字预览 → 用户确认 → 卡片」；留待产品决策 |
| A-8 渠道当 ID / 类型 | ✅ 已修 | 工具事实带真实 `channelId`；`applyWithdrawVerified` 校验 `type=2`；卡片拒发充值渠道（T8） |
| A-9 卡片显示「渠道 #1」 | ✅ 已修 | `buildFields` 使用 `channelName`（T8） |
| A-10 过期后幻觉「已提交」 | ✅ 已修 | 短确认确定性路由（T4）+ 发布事实闸门（T5） |
| A-11 过期无提示 | ✅ 后端已修 | 文字确认对终态卡片返回「已过期/已处理」（T4）；前端倒计时仍需回归 |
| A-12 过期券进入可领取/发卡 | ✅ 已修 | `isCouponClaimableNow` 过滤可领取列表（T6 原为 Task 1）；`claimCoupon` 补有效天数/未开始/无结束时间校验；守卫按真实原因提示；错误中文化 |
| A-13 序号跨列表错位 | ✅ 已修 | 单一编号列表 + 编号只绑定最近展示列表 + 弹卡前复述券名 + 不可领不换券；`getUserCoupons` 默认只查未使用 |
| 21 生产 OTP 固定码 | ⏸ Blocked | 产品决策；计划未擅自改 |
| 22 handoff 不撤销动作 | ✅ 已修 | `routeTransfer` 调 `markTransferred`；gate/reset 作废 DB 卡片（T11） |
| 23 成员校验越权 | ✅ 已修 | `prepareThread` 的 404 直接收尾，不写 trace/不转人工（T11） |
| 24 buildParams 死代码 | ✅ 已修 | `issueConfirmCard` 用目录白名单生成执行参数（T8） |
| 25 完整账号泄露 | ✅ 已修 | `summary` 服务端渲染并掩码；调试快照也掩码（T8/T11） |
| 26 令牌明文日志 | ✅ 已修 | 只打印前 8 位（T6） |
| 27 卡片签发无幂等 | ✅ 已修 | 同消息同动作复用 `CONFIRM_CREATED` 行（T6） |
| 28 OTP 5N 尝试 | ✅ 已修 | 重发即作废旧 PENDING（T7） |
| 29 生命周期非状态机 | ✅ 已修 | `updateStatus` 带允许迁移列表（T6） |
| 30 取消无令牌/单 pending | ✅ 部分修复 | pending 用 `setNx` 单占位；取消支持 `requestId` 绑定，旧客户端保留 fallback+warn（T7） |
| 31 改地址清空姓名 | ✅ 已修 | 局部更新先读当前地址做兜底（T8） |
| 32 调试接口泄露 | ✅ 已修 | `pendingConfirm` 的 params/summary 掩码（T11） |
| 33 自检正则/未知工具 | ✅ 已修 | 正则补 update/set/bind/cancel；未知工具 fail-closed（T9） |
| 34 目录外动作发死卡 | ✅ 已修 | `issueConfirmCard` 无目录项不发卡（T8） |

**仍未闭环**：A-7（双重确认，产品决策）、21（生产 OTP，产品决策）、Flutter 侧 `requestId` 与卡片倒计时的回归。
