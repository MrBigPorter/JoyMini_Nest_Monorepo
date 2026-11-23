# Current Task — 两周补齐计划（生产化 + 岗位就绪）

> 更新: 2026-11-19
> 依据: [#85 生产化差距审计](./AI-joymini/85-生产化差距审计与企业上线清单.md)、[#86 岗位匹配度与路线图](./AI-joymini/86-岗位匹配度评估与两周补齐路线图.md)
> 当前得分: **≈79 / 100**（2026-11-20 按 #86 §10 逐维重评）

---

## 核心原则

**先建度量，再改代码。**
每个修复都要能说出一句话：「这条改动把 X 指标从 A 提到 B」。没有数字的改动，在面试里等于没做。

---

## 优先级队列（严格按顺序，不要跳）

### 🥇 T0 — 先做（Day 0-2）

|  #   | 任务                                      | 文件                                                                                                     | 产出                                  |                         状态                         |
| :--: | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- | :--------------------------------------------------: |
| T0-1 | 提交工作区 16 个文件                      | —                                                                                                        | 基线 commit，`tsc --noEmit` 通过      |                    ✅ 2026-11-11                     |
| T0-2 | 结构化日志：traceId + 意图 + 耗时 + token | 新建 `common/logger/`，埋点 `ai-customer.service.ts`、`orchestrator.node.ts`、`rag-retrieval.service.ts` | 一条对话可按 traceId 串起来           |                    ✅ 2026-11-11                     |
| T0-3 | golden set + 回放脚本（Python）           | 新建 `tools/eval/`                                                                                       | `tools/eval/run-replay.sh` 输出基线分 | ✅ 2026-11-12（63 题，准确率 68.2%，macro-F1 68.6%） |

> 为什么先做这 3 件：没有 T0-2 看不到问题，没有 T0-3 证明不了修好了。
>
> T0-3 已完成（2026-11-12）：[`tools/eval/`](../tools/eval/) 63 条人工标注 + Python 回放，打在生产分类路径（`POST /admin/intent-examples/test`，与 `intent-router.node.ts` 同一个 `IntentClassifier`）。**首跑基线：Top-1 68.2%（43/63）、macro-F1 68.6%、p50 415ms**；最弱是 `rag`（精确率 38.9%，把 kyc/wallet/order/user 的问题吸走）。设计见 [#94](./AI-joymini/94-意图准确率基线-T0-3.md)。
>
> T0-1 已完成（2026-11-11）：基线提交 `d1eda1b0` → `de8e8f0e`，含 #88 元数据合并、导入/校验 CLI、知识库批量上传、N-6 向量化健壮性修复；`tsc --noEmit` 0 error。
>
> T0-2 已完成（2026-11-11）：按 [#89 SDD](./AI-joymini/89-AI对话可观测性-SDD.md) 落地 `common/logger/`（`runWithTrace` / `emitStage`），埋 8 类事件；App 真实对话走 `AiMessageListener`（事件总线）而非 SSE 控制器，trace 在该入口生成。真实对话实测同 traceId 串起 5~7 条事件，`tokenTotal` 1275 / 1072 / 120，转人工 `transferred:true`；单测 11/11、全量 153/153。生产 Loki 验收（AC-9/AC-10）随发布进行。顺带修复 N-7（转人工被分数门槛短路）、N-8（三处日志泄露原文）、N-9（AI 回复只发会话房间 → 双通道投递）、N-10（转人工词子串误判 → 强弱分级）、N-11（转人工原因丢失 / SSE 缺 intent 帧）。
>
> 配套自测工具（2026-11-11）：[`scripts/ai-e2e-smoke.sh`](../scripts/ai-e2e-smoke.sh)，说明见 [#90](./AI-joymini/90-AI客服端到端自测脚本.md)。一条命令跑 8 个真实流量场景（闲聊 / RAG / 明确转人工 / 强负面 / 弱负面×2 / 子串误判×2），断言意图 + 是否转人工 + 原因 + 双通道投递；首跑 **8/8 PASS**。`WITH_REPEAT=1` 追加"连续重复 4 次才转人工"。注意：脚本会在聊天列表留一条 `【AI自测】` 会话。
>
> T2-6 运行时验证（2026-11-12）：`WITH_FAILURE=1` 追加第 9 场景「模型故障降级」——Redis 写故障开关 + 发 `__CHAOS__ 你好`，断言兜底话术落库、`handler_id=awaiting_human`、`transfer{source:fallback,reason:ai_error}`、`chat.error`。**9/9 PASS**，N-15 转 ✅。
>
> T1-1 部分闭环（2026-11-12）：删掉所有环境都执行的验证码明文日志；`isProd` 改 `isDev`（fail-closed，只有明确 `development` 才用固定码并返回 `devCode`）；生产环境 `OTP_PEPPER` 缺失或 < 16 字符直接拒绝启动；`requestIp` 经 `@RealIP()` 入库；发送状态改为 `PENDING → send → SENT/FAILED`，不再抢在实际发送之前写「已发送」；发短信抽成 `SmsProvider` 接口 + 工厂，生产暂用显式抛错的占位实现。顺带修两处未登记缺陷：`verifyTimes` 每次尝试被 +2（5 次实为 3 次）、`verify` 用未 trim 的 `phone` 查单。**仍缺真实短信供应商**（生产调用抛 `NotImplementedException`），另遗留 pepper 两个读取时机的隐患（#87 N-19）。`tsc` 0 error，全量 308 passed。
>
> T1-3 闭环（2026-11-12）：审核只置 `PROCESSING`、回调/cron/审核失败统一走 `settleWithdrawal`（新建 `withdraw-settlement.service.ts`）、冻结扣毛额 `withdrawAmount` 而累计提现记净额 `actualAmount`、补单 cron 修掉"查询异常当成查无此单"的误判。新增单测 8 例；`tsc` 0 error，全量 308 passed。
>
> T1-5 闭环（2026-11-13）：`claimCoupon` 删掉「先查库存再无条件 +1」，改为 `updateMany({ where: { id, issuedQuantity: { lt: totalQuantity } } })` + `count !== 1` 抛错（`totalQuantity = -1` 不限量时不给 `WHERE` 加条件）。顺带做了一次全项目并发审计：**9 处已正确使用条件更新**（秒杀/盲盒库存 raw CAS、钱包扣减与冻结、充值回调幂等、抽奖券与奖品库存、拼团 version 乐观锁），**2 处漏掉**并已一并修复：① [order.service.ts](../apps/api/src/client/orders/order.service.ts) 同一张券可被并发两单抵扣（`findFirst(status:0)` → 无条件 `update(status:1)` 改为条件 `updateMany` + `count`）；② [lucky-draw.service.ts](../apps/api/src/common/lucky-draw/lucky-draw.service.ts) 抽奖发券超发（`issueCouponInTx` 同款问题）。新增 `coupon.service.spec.ts` 4 条，做过「去掉 `count` 判断 → 并发用例变红」验证。`tsc` 0 error，全量 322 passed（3 条已知过期断言不变）。
>
> T1-6 闭环（2026-11-13）：`claimCoupon` 的「每人限领」检查从扣库存**之前**挪到**之后**。没有新增任何锁机制，靠的是已有的**行锁**——`updateMany` 扣库存会给券模板那一行加写锁并持有到事务提交，同一张券的并发请求因此被迫排队；排队结束再 `count()`，READ COMMITTED 下新语句拿新快照，能看见前一个事务刚提交的券，超限即抛错（扣掉的库存随事务一起回滚）。没走唯一索引，因为 `perUserLimit` 是变量，索引只能表达「1」。新增 2 条测试，其中一条是**顺序探针**（`invocationCallOrder` 断言 `updateMany` 先于 `count`）——顺序调回去它立刻变红，而行为测试在 mock 下抓不到这个回归（mock 没有锁）。同时修掉 `// 悲观锁锁定券模板` 那句假注释（`findUnique` 是普通读，根本不上锁）。`tsc` 0 error，全量 324 passed（3 条已知过期断言不变）。**代价**：这个保证是隐式的，依赖「扣库存在前、且与查限领同一事务」，代码里已用注释钉死。
>
> T2-5 S2-B 完成（2026-11-13）：**回复即接管**。客服打字回复这件事本身就是接单动作，不再依赖没人会点的「接入」按钮。`replyToConversation` 按读到的 `handlerId` 三分支：① `awaiting_human` → 复用 S1 的 `claim` CAS，抢输抛 409 **且消息不发**；② `null`（AI 处理中）→ 条件更新 `WHERE handler_id IS NULL` 接管，抢输仍照发（否则 AI 下一条还会插话）；③ 别人/自己名下 → 照发、归属不动（产品决策：允许帮答，团队可顶班）。返回体加 `claimedNow` / `handlerId`，前端据此把卡片从「待接入」移到「我的」。**修掉两个自己写出来的 bug**：`if (!conv) throw` 被放到使用之后（会话不存在时 `null.handlerId` → 500 而非 404，被 `tsc` 的 `'conv' is possibly null` 抓到）；认领成功但漏写 `claimedNow = true`（数据库归你了、接口却回 false，UI 与真实状态分叉）。**实测**：排队中回复 → `claimedNow=true`；别人名下 → `claimedNow=false` 且归属不变；AI 会话 → 接管；不存在 → 404；**两个不同身份并发回复排队会话 → 409 + 201，只落库 1 条消息**。红绿验证：短路 `if (result.status !== 'claimed')` 后「撞车不发」立刻变红。累计 23 条测试。**已知边界**：409 只覆盖「两人同时读到 awaiting_human」的窗口；晚到的客服走帮答分支照常发送——主防线是 S3 的实时列表移除，409 只是兜底。**未做**：`firstResponseAt`、socket 推送、SLA 回收。
>
> T2-5 S2-C 完成 + 排队时钟修正（2026-11-14）：`replyToConversation` 在消息发出**之后**写 `firstResponseAt`，用 `updateMany({ where: { id, firstResponseAt: null } })` 而不是 `update`——帮答场景两人几乎同时回复，后者会把「首次」冲成「最后一次」（有顺序探针测试钉住「先发消息、后记时间」，按时间倒过来记的是「没发出去」的时刻）。**实测暴露出一个存量缺陷**：`handlerAssignedAt` 比 `firstResponseAt` 还晚 3 秒——`chat.service.ts` 的懒超时逻辑在 `handlerId != null` 时每条消息都刷新它，而 `'awaiting_human'` 也满足这个条件。后果：① 排队用户再发一句，`waitingSeconds` 被重置；② 按 `handlerAssignedAt asc` 排序等于「按最后活跃时间排」，催得越急排得越后；③ 响应时长 KPI 算出负数。**修法**（把两个时钟的职责拆开）：`transferredAt` = 排队起点（不动），`handlerAssignedAt` = 活跃时间（可刷新）。两处转人工写入补齐 `transferredAt` + `transferReason`（`ai-customer.service.ts` 的 `routeTransfer`、`ai-failure-handler.ts` 的 `degradeToHuman`），手工切人工的 `switchHandler` 同样补；待接入排序改为 `{ transferredAt: { sort: 'asc', nulls: 'last' } }`（老数据垫底而不是抢占队首）。**实测**：A 会话 10 分钟前转人工、1 秒前刚有消息，B 会话 2 分钟前转人工——A 仍排第一且 `waitingSeconds=600`（修复前会变成 1s 并掉到队尾）。`tsc` 0 error，三个套件 216 passed。**未做**：让 `chat.service` 对 `awaiting_human` 不再刷新 `handlerAssignedAt`（影响面在 socket 侧，留给 S4 与超时回收一起改）、socket 推送、SLA 回收。
>
> T2-5 S2-A/D 完成（2026-11-13）：**队列第一次可见**。`GET /admin/chat/conversations` 新增 `queue=awaiting|mine|ai|all`（与 `status` 正交），`mine` 的 adminId 只从 JWT 取（有防越权测试）；返回体加 `waitingSeconds` + `transferReason`，待接入按 `handlerAssignedAt` **升序**（等最久的排最前，防老会话被新会话淹没）。两个已存在的错一并修掉：① `claim` 的 CAS 加 `status: ConversationStatus.NORMAL`（否则历史脏数据里「已关闭但 handlerId 仍是 awaiting_human」的会话能被接走）；② `closeConversation` 在**同一事务**里清 `handlerId` / `handlerAssignedAt`，但保留 `transferredAt` / `transferReason` / `firstResponseAt`（状态要清、审计要留）。**踩坑记录**：`waitingSeconds` 曾写成 `() => {...}`（函数而非值），`tsc` 不报错、JSON 序列化把字段整个丢掉；已用「`typeof === 'number'`」测试钉住，红绿验证过（改回函数形式恰好 2 条变红）。实测：`queue=awaiting` 返回 1563s/123s/8s 且顺序正确，`queue=ai` 的 `waitingSeconds` 为 `null`（不再拿 `createdAt` 冒充），关闭后会话从待接入和「我的」同时消失、`transferReason` 保留。累计 17 条测试。**未做**：回复即认领、`firstResponseAt`、socket 推送、SLA 回收。
>
> T2-5 S1 完成（2026-11-13）：转人工闭环的**认领动作**落地。`SupportHandlerService.claim` 用条件 `updateMany({ where: { id, handlerId: 'awaiting_human' } })` 把「还在排队」下推到 SQL——改到 1 行=抢到，0 行=被抢走；随后才查一次库只为区分 404 / 409（结论仍由 CAS 定死，那次查询不参与判定）。`AdminChatService.claimConversation` 只做「三选一 → HTTP」翻译，自身不查库（有测试钉住）。接口 `POST /api/v1/admin/chat/conversations/:id/claim`，`VIEWER` 角色不可调用。新增迁移 `20261113080843`：三个可空列（`transfer_reason` / `transferred_at` / `first_response_at`）+ 待接入队列索引 `idx_conv_support_queue`，`Conversation` 首次有索引。**实测**：同一会话连点两次 200 → 409；8 个并发只有 1 个 200、7 个 409。单测 9 例（含 CAS 探针与「翻译层不碰库」）。**未做**：admin 待接入列表、socket 事件推送、SLA 定时回收（S2–S4）。
>
> T1-4 闭环（2026-11-13）：`join_chat` 补成员校验（匿名直接拒、不查库）；`send_message` 在 `$transaction` **之前**补成员校验（非成员连事务都开不起来），并把缺 `conversationId` 的错误码从 `Forbidden` 纠正为 `Invalid payload`；`createOrGetAiConversation` 改为 `findFirst` + `members: { some: { userId } }`，非成员与「会话不存在」同走 404（不泄露会话是否存在）。Socket 两侧共用 `EventsGateway.isConversationMember`；AI 侧用 Prisma 关系过滤，不重复写校验逻辑。新增 `events.gateway.spec.ts` 7 条 + `ai-memory.service.spec.ts` 3 条，均做过「拆锁 → 红、装锁 → 绿」验证。`tsc` 0 error，全量 318 passed（3 条已知过期断言不变）。**遗留**：若 App 存在「未登录游客浏览公开群」场景，`join_chat` 现在会拒绝 —— 需要公开群白名单（N-20）。
>
> T1-2 闭环（2026-11-12）：`peek → verify → pop`（验码失败不再毁任务）、`TOKEN_TTL_SEC=60` / `PENDING_TTL_SEC=330` 拆开、`plainToInstance + validate` 真校验并拒多余字段。新增 `ai-action-confirm.service.spec.ts`（6 例）+ `ai-customer.service.spec.ts`（8 例）；`tsc --noEmit` 0 error，全量 300 passed（`auth` / `flash-sale` 两个已知过期 suite 除外）。

### 🥈 T1 — 安全与资金（Day 3-8）

|  #   | 任务                                                                  |   #85 ID   | 文件                                                                                                           |                                                         状态                                                          |
| :--: | --------------------------------------------------------------------- | :--------: | -------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------: |
| T1-1 | 生产 OTP：接短信 + 启动校验 pepper + 去明文日志                       |    P0-4    | `client/otp/otp.service.ts`                                                                                    | ✅ 2026-11-20 生产永久使用测试码（`compose.prod.yml`，默认 `999999`，可用 `OTP_FIXED_CODE` 覆盖；不再计划接真实短信） |
| T1-2 | 确认链路三洞：验码后再删 / TTL 对齐 300s / 复用 DTO 校验              | P1-7/17/18 | `ai-customer.service.ts`、`ai-action-confirm.service.ts`                                                       |                   ✅ 2026-11-12（单测 14 例，见 [#93 §3.1](./AI-joymini/93-确认链路三个洞-SDD.md)）                   |
| T1-3 | 提现冻结状态机：审核只置 PROCESSING + `settleWithdrawal`              |    P0-3    | `admin/finance/finance.service.ts`、`client/wallet/client-wallet.service.ts`                                   |                   ✅ 2026-11-12（单测 8 例，见 [#95 §5.1](./AI-joymini/95-提现冻结状态机-SDD.md)）                    |
| T1-4 | Socket 成员校验 + AI 会话 IDOR + `AI_CONFIRM` 改私有房间              |   P0-1/2   | `events.gateway.ts`、`ai-memory.service.ts`、`ai-customer.service.ts`                                          |                                         ✅ 2026-11-13（3 处入口 + 14 条测试）                                         |
| T1-5 | 领券原子扣减（含全项目并发审计，顺带修优惠券重复抵扣 / 抽奖发券超发） |    P0-5    | `client/coupon/coupon.service.ts`、`client/orders/order.service.ts`、`common/lucky-draw/lucky-draw.service.ts` |                                          ✅ 2026-11-13（超卖已修，4 条测试）                                          |
| T1-6 | 每人限领并发：`count()` + `create()` 可被同一用户并发突破             | P0-5 余项  | `client/coupon/coupon.service.ts`                                                                              |                                         ✅ 2026-11-13（检查后置 + 顺序测试）                                          |

### 🥉 T2 — AI 质量（Day 8-9）

|  #   | 任务                                                                                                                                                                                                         |   #85 ID    | 文件                                                                    |                                                                                                     状态                                                                                                     |
| :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------: | ----------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| T2-1 | 转人工：词边界匹配 + 情绪分级 + 工单写入 + 消费者                                                                                                                                                            |    P1-19    | `transfer-detector.ts`、新增 admin 消费者                               |                                                                   ✅ 2026-11-19（强/弱负面分级 + SupportQueueChanged 事件消费者；见 #98）                                                                    |
| T2-2 | 意图阈值统一为单一常量 + 融合后再过滤                                                                                                                                                                        |    P1-20    | `intent-classifier.ts`、`intent-router.node.ts`、`orchestrator.node.ts` |                                                             ✅ 2026-11-19（常量收口 + 门槛移到融合后；回放 83.7%→84.3%，rag 精确率 78.6%→80.0%）                                                             |
| T2-3 | RAG：中文分词 + Layer 2 占位符 + 向量相关性门槛                                                                                                                                                              |    P1-21    | `rag-retrieval.service.ts`                                              | ✅ 2026-11-20（分词/Layer2/RRF + rerank 相关性门卫；关键词层 Recall 0→89.9%，负样本误召回 100%→5%；见 [#104](./AI-joymini/104-RAG中文召回修复与分层验收.md)、[#105](./AI-joymini/105-RAG相关性门卫验收.md)） |
| T2-4 | 流式白名单：帧类型白名单 + `step` 帧字段白名单（非「只转发最终文本」）                                                                                                                                       |    P1-22    | `ai-stream-frames.ts`、`ai-customer.controller.ts`                      |                                      ✅ 2026-11-19（5 类帧 + `step/content/tool`；`ai-stream-frames.spec.ts` 9 例；开关 `AI_STREAM_FRAME_WHITELIST_ENABLED` 默认开启）                                       |
| T2-5 | **转人工闭环**：admin「待接入」列表 + 订阅 `AI_TRANSFER` 通知 + 超时定时回收（现在只在用户下条消息时懒判定）                                                                                                 | N-13 / N-14 | `admin/chat/`、`admin-next/.../customer-service/`、新增 cron            |                                                     ✅ 2026-11-19（S1/S2 + S3 实时推送 + S4 空闲回收；见 [#98 §14](./AI-joymini/98-转人工闭环-SDD.md)）                                                      |
| T2-6 | **模型兜底**：`timeout 15s + maxRetries 1`；`degradeToHuman` 落固定话术 + 置 `awaiting_human` + 发 `AI_TRANSFER` + 记 `transfer{source:fallback}`；测试用故障注入（`__CHAOS__` 前缀 + Redis 开关，生产隔离） |    N-15     | `graph/llm-factory.ts`、新增 `ai-failure-handler.ts`                    |                                                                        ✅ 2026-11-12（单测 5 例 + E2E 第 9 场景实测，全套 9/9 PASS）                                                                         |
| T2-7 | **成本限额**：按天聚合客服 token，超阈值降级转人工 + 记 `cost.guard`（复用 blog budget 写法）                                                                                                                |    N-16     | `ai-customer.service.ts`、新增 cost-guard                               |                                                      ✅ 2026-11-19（日累计 + 会话累计两级配额，超限走 quota_exceeded 降级；见 reliable-ai-runtime 5.x）                                                      |

### 🛡️ T2.5 — 信任边界（agent-trust-boundary，规格见 `openspec/changes/agent-trust-boundary/`）

> 目标：让「操作主体」不可能来自模型、写操作不可能绕过确认、内部结构不可能从 SSE 出网。
> 边界与残余风险见 [`docs/system-review/agent-trust-boundary-安全边界说明.md`](./system-review/agent-trust-boundary-安全边界说明.md)。

|  #   | 任务                                                                                      |   #87 ID    | 文件                                                                 | 状态                                                                                                                                                                         |
| :--: | ----------------------------------------------------------------------------------------- | :---------: | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB-1 | 工具身份只来自请求上下文（`requireToolUserId` / AsyncLocalStorage），schema 删除 `userId` |  P1-6 根因  | `graph/tools/tool-identity.ts`、`common/logger/trace-context.ts`     | ✅ 2026-11-19（无上下文 fail-closed；7 个工具套件断言模型伪造 `userId` 无效）                                                                                                |
| TB-2 | 写工具能力标记 + 确认流程由 `capability.kind === 'write'` 推导                            |    P1-6     | `tool-registry.service.ts`、`orchestrator.node.ts`                   | ✅ 2026-11-20（7 个写工具；启动自检已落地，实测报出 `requestWithdrawOtp`/`verifyWithdrawOtp` 未声明 write）                                                                  |
| TB-3 | 归属校验：`draw` / `updateAddress` / `deleteAddress` 执行前比对归属                       | P1-6 / P2-4 | `lucky-tools.ts`、`user-tools.ts`                                    | ✅ 2026-11-19（他人目标 → 结构化 `FORBIDDEN` + `tool.denied`）                                                                                                               |
| TB-4 | 输入注入检测（覆盖指令 / 索取内部结构 / 越权试探），命中降级 `general`                    |    P2-4     | `injection-detector.ts`、`intent-router.node.ts`                     | ✅ 2026-11-20（三档模式 off/log/enforce 已合入；生产 `compose.prod.yml` 使用 log 观察，误报率确认后切 enforce）                                                              |
| TB-5 | SSE 帧白名单（类型 + `step` 字段）                                                        |    P1-22    | `ai-stream-frames.ts`、`ai-customer.controller.ts`                   | ✅ 2026-11-19（见 T2-4）                                                                                                                                                     |
| TB-6 | 同会话单飞：进程内队列 + Redis `SET NX PX` 锁，异常路径释放                               |    P1-3     | `ai-message.listener.ts`、`redis-lock.service.ts`                    | ✅ 2026-11-19（`ai-message.listener.spec.ts` 4 例；超时有界等待后 warn 放弃）                                                                                                |
| TB-7 | Socket 触发 AI 入口复用 SSE 令牌桶                                                        |    P1-3     | `events.gateway.ts`、`common/rate-limit/sse-rate-limiter.service.ts` | ✅ 2026-11-19（工作区已接 `tryAcquireLight`，与 HTTP 共用 key；`events.gateway.ai-rate-limit.spec.ts` 4 例 + `sse-rate-limiter.service.spec.ts` 3 例；生成文档时**未提交**） |
| TB-8 | `(conversationId, seqId)` 唯一约束                                                        |    P1-11    | `prisma/schema.prisma`、迁移 `20261119170000`                        | ✅ 2026-11-19（DB 唯一索引 + `scripts/e2e-message-seq.js` 并发实测：两条消息 seq 不同且都落库）                                                                              |

### 🏅 T3 — 收口（Day 10）

|  #   | 任务                                       | #85 ID |                                                                           状态                                                                           |
| :--: | ------------------------------------------ | :----: | :------------------------------------------------------------------------------------------------------------------------------------------------------: |
| T3-1 | 3 个集成测试：转人工 / 确认卡片 / RAG 降级 | P1-25  |               ✅ 2026-11-20（转人工 + RAG 降级已有 smoke；确认卡片由 `scripts/ai-confirm-card-e2e.sh` 覆盖：生成 pendingConfirm 且不落库）               |
| T3-2 | 复跑 golden set，出「改前 vs 改后」对比表  |   —    | ✅ 2026-11-19（153 题 55.6% → 86.9%；见 [#100](./AI-joymini/100-意图评测扩容与中文召回修复.md)、[#101](./AI-joymini/101-意图阈值收口与融合顺序修正.md)） |
| T3-3 | 更新 #86 §10 进度追踪（填真实分数）        |   —    |                                                    ✅ 2026-11-20（逐维重评 75/85/80/80/75，总分 79）                                                     |

### 🧊 T4 — 有余力再做

| 项                                               | #85 ID              | 状态                                                                               |
| ------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------- |
| 状态机版本 / 绑定切换 / 回滚                     | 新增（JD 明确要求） | ✅ 2026-11-20（flowState 接通 + 定义版本/绑定/审计 + checkpoint 状态回滚）         |
| Outbox + 死信消费 + 消费端幂等                   | P2-5                | ✅ 2026-11-20（事务登记 + relay + 单条重放 + 保留期清理）                          |
| 长期记忆（PG checkpointer + `saveContext` 落库） | P1-23               | ✅ 2026-11-20（用户级蒸馏记忆 + 白名单 + TTL/注销删除）                            |
| PromptResolver 真合并                            | P1-24               | ✅ 2026-11-20（PR #70 深合并）                                                     |
| AI 回复 `isAi` 标记 + 走 `MESSAGE_CREATED`       | P1-1/2              | ✅ 2026-11-20（后端 + Flutter 均已提交；Flutter 分支 feat/chat-ai-message-events） |
| 上下文预算 / 摘要 / 实体纠正 / 澄清              | 新增                | ✅ 2026-11-20（token 预算 + contextState + 指代澄清）                              |

### 📝 验收发现（2026-11-22，待修）

|  #   | 发现                                                                                                         | 证据 / 根因                                                                                                                                                                                                     | 建议修法                                                                 | 状态 |
| :--: | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | :--: |
| A-1  | AI 回复优惠券时把 **₱（菲律宾比索）写成 ¥（人民币）**                                                      | 同一条消息里券名是 `💰 Big Spender — ₱200 Off`，正文却是「优惠面值 ¥200.00 / 门槛 ¥1000.00」。`ai_traces` 2026-11-22 15:32:51，intent=coupon，tool=`getClaimableCoupons` 10ms。根因：`ClaimableCouponResponseDto` 只暴露 `discountValue` / `minPurchase` 裸数值，没有 `currency` 字段（[claimable-coupon-response.dto.ts](../apps/api/src/client/coupon/dto/claimable-coupon-response.dto.ts)），模型自行猜了符号 | 在工具输出层直接拼好带货币符号的展示串（推荐），或 DTO 补 `currency` 字段让模型只转述 | 待修 |
| A-2  | 领券确认阶段模型把**列表序号当 couponId**，被守卫拦下后对用户谎称「没有找到这张可领取的优惠券」 | 实测 2026-11-22 15:35：用户回「可以」→ AI 回「没有找到这张可领取的优惠券，可能已经领过或已下架」。但券真实存在且可领（`per_user_limit=1111`，用户仅持 1 张）。PG checkpoint `pendingConfirm.params.couponId = "2"`（序号），真实 ID 是 `cmrghb8hm003gpc655qi095k8`。守卫在 [ai-customer.service.ts:1620-1664](../apps/api/src/client/ai-customer/ai-customer.service.ts#L1620-L1664)，只做精确 ID 匹配，未建 `ai_action_requests` 记录 | 让模型能拿到 ID：在列表回复里带上 `couponId`（或工具支持按名称/序号服务端解析）；守卫命中失败时改为「重列可领券并请用户点选」而非断言不存在 | 待修 |
| A-3  | 无卡片生成时 trace 仍记 `status=CONFIRM`                                                                     | 15:35 那次 `ai_traces.status=CONFIRM`，但 `ai_action_requests` 当天 0 条；按状态做告警会误判为「确认卡已下发」                                                                                                         | trace 状态应区分「进入 confirm 路由」与「卡片实际创建」                                                                                   | 待修 |
| A-4  | 提现渠道手续费**只暴露固定部分，漏掉费率**，AI 报「GCash 手续费 ₱5.00」，实际 ₱5.80（₱100 × 0.8% + ₱5），到账应为 ₱94.20 而非 ₱95.00 | 实测 2026-11-22 15:38 AI 渠道表写 `GCash Withdraw … 手续费 ₱5.00`；15:44 用户给出全部参数后，AI 的确认前摘要再次写「手续费 ₱5.00 / 实际到账 ₱95.00」。库里 `payment_channels` 两条都有 `fee_rate`（0.008 / 0.01）+ `fee_fixed`（5 / 10）。根因：`PaymentConfigItemDto` 只映射 `feeFixed → fee`，**没有 feeRate 字段**（[payment-channel.dto.ts:54-61](../apps/api/src/client/payment-channel/dto/payment-channel.dto.ts#L54-L61)），模型看不到费率。确认卡（`routeConfirm`）算费时用的是完整公式，所以**卡片会显示 ₱5.80 / ₱94.20，与 AI 的文字摘要对不上** | DTO 增加费率字段，或在工具输出里直接给出按金额算好的总手续费 | 待修 |
| A-5  | **会话 token 配额耗尽被当成 AI 故障**：用户看到「人工客服暂时不在线，您可以先留言」，实际是配额满了，AI 并没有听不懂 | 实测 2026-11-22 15:40：用户发「金额：100，渠道：Gcash」→ `ai_traces` 12ms `status=ERROR`，`metadata.errorName=SessionQuotaExceededError`；Redis `ai:session:tokens:cmrj13rnm…=50083`（limit 50000，`ai-usage.service.ts:146-171` 默认值），TTL 还有 ~24h。50k 只够约 6~10 轮（单轮 prompt 4k~8k）。`handleStreamError` 把配额异常与其他故障同样处理 → `degradeToHuman` → 无客服在线 → 留言话术（[ai-failure-handler.ts:37-38](../apps/api/src/client/ai-customer/ai-failure-handler.ts#L37-L38)） | 配额耗尽单独话术（如「本次对话较长，已转人工」）；开发环境提高 `AI_SESSION_TOKEN_LIMIT`；配额耗尽不应静默走离线留言。**验收现场已手动 `DEL` 该 Redis key 继续测试** | 待修 |
| A-6  | **AI 客服没有「新会话」边界，配额对长期用户永远不重置**（A-5 的根因，属于生产级缺陷）               | ① 会话是永久的：`ai-memory.service.ts:82-99` 用 `businessId = ai_chat:{userId}` find-or-create，一个用户一辈子一个会话；当前测试会话创建于 2026-07-13。② 配额 key 也是永久的：`ai-usage.service.ts:185-189` 每条消息 `INCRBY` 后都 `EXPIRE 24h`，TTL 被不断续期——只要用户每天用一次，计数器**永远不过期**，攒够 50k 后 AI 对该用户永久不可用（直到连续 24h 不说话）。「会话通常很短」的假设与「一个用户一个会话」的实现互相矛盾 | 定义真正的会话边界：按自然日计数（key 里带日期）或首次写入后才设 TTL、后续不续期；或直接改用已有「按天聚合」配额，删掉会话级配额；另需给配额耗尽单独话术 | 待修 |
| A-7  | 提现是**双重确认**：AI 先在文字里问「是否确认？」，用户回「确认」后才调用写工具、才弹确认卡 | 实测 2026-11-22 15:44：AI 输出摘要并问「确认无误的话…请问是否确认？」，但本条 trace 只有 intent/rag/llm 三个 span，**没有调用 `applyWithdraw`**，`pendingConfirm` 为 null、无 `ai_action_requests` 记录。写工具描述本身要求「Must get user explicit confirmation before calling this tool」，而 orchestrator 又有一层确认卡（[orchestrator.node.ts:695-708](../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts#L695-L708)） | 二选一：留卡片作为唯一确认（模型拿齐参数直接调工具）或留文字确认（卡片改为执行确认）；当前两层叠加，用户要说两次「确认」 | 待定 |
| A-8  | **模型把「GCash Withdraw」解析成 channelId=1（PH_GCASH 充值渠道）**，确认卡按错误渠道算费 ₱0、到账 ₱100；若 60s 内确认会按充值渠道执行提现 | 实测 2026-11-22 15:46：`ai_action_requests` `withdraw` 的 `params.channelId=1`（正确应为 5），`summary={fee:"0", netAmount:"100"}`；同一流程里出现三个金额：文字摘要 ₱5/₱95、卡片 ₱0/₱100、GCash Withdraw 真实 ₱5.80/₱94.20。根因：① AI 展示的渠道表没有渠道 ID 列，模型只能自行映射；② [`applyWithdraw`](../apps/api/src/client/wallet/client-wallet.service.ts#L441-L446) 只查 `id + status`，**不校验 `channel.type === 2`**，充值渠道也能提现 | 渠道列表向模型暴露 ID；写工具执行前校验 `channel.type=2`；卡片展示渠道名而不是 ID | 待修 |
| A-9  | 确认卡显示「渠道 #1」——**原始 ID 直接渲染给用户**                                                                          | 同 15:46 卡片文案「请确认：提现确认 / 渠道：渠道 #1」。即使 ID 正确也会显示「渠道 #5」，用户无法判断是哪个渠道                                                | 卡片 summary 里带渠道名（`channelName`），前端只展示名称                                                                                 | 待修 |
| A-10 | **AI 谎报成功**：卡片过期后用户输入「确认」，AI 回复「提现申请已提交，正在等待短信验证码」，实际什么都没发生                | 实测 2026-11-22 15:48 两次「确认」：`ai_action_requests` 无新记录（上一条 `withdraw` 已于 15:47:58 `EXPIRED`），trace 只有 intent/rag/llm 三个 span、无 tool；`user_wallets.frozen_balance` 仍为 0；未调用 `requestWithdrawOtp`，没有 OTP 下发。同时意图被分类成 **`kyc`**（连续三轮），不是 wallet | 确认卡只接受卡片按钮（token）；文字「确认」应检测 pending/expired 动作并提示「已过期，请重新发起」；意图路由不应把短确认语判成 kyc | 待修 |
| A-11 | 用户体验：输入「确认」没有反应，卡片过期无任何提示                                                                          | 用户先看到卡片（15:46:58），60 秒后过期；15:48 两次输入「确认」都只是普通聊天，前端/后端都没有「卡片已过期」的提示或自动重发                                              | 过期时推送事件/系统消息；聊天里输入「确认」时关联最近一条 `ai_action_requests` 并给出明确结果                                     | 待修 |
| A-12 | **已过期的券仍出现在「可领取」列表，并能生成领券确认卡** | 实测 2026-11-22 18:33：`💰 Big Spender — ₱200 Off` 模板 `valid_end_time=2026-08-10`（已过期），`status=1`，AI 仍为它创建了 `claim_coupon` 确认卡（`ai_action_requests.status=CONFIRM_CREATED`）。根因：`getClaimableCoupons` 只按 `issueType=2 + status=1` 过滤，**不校验 validity 窗口**；`claimCoupon` 执行时会以 `This coupon has expired` 拒绝，所以不会真的发出过期券，但用户会先看到卡再收到错误 | 可领取列表按 `validType=1` 的 `validStart <= now <= validEnd` 过滤；`issueConfirmCard` 的 claim 守卫也补一次过期校验；`getMyCoupons` 对过期券标 `已过期` 而不是当可用券展示 | ✅ 已修（b744ea37 / ec001bcc / f3be78c8） |
| A-13 | **用户说的券序号被解析到另一张列表**（说「领取1」却领了第2张） | 实测 2026-11-22 18:33：用户刚看到「我的券」列表（1 Fixture、2 Big Spender），说「帮我领取1」；模型改调 `getClaimableCoupons`，把 1 解析成 Big Spender。根因：序号没有绑定「最近展示的列表」，模型在两套列表间切换；同时可领取列表未过滤过期券（A-12） | 同一轮只展示一个带编号列表；编号只解析最近展示列表；弹卡前复述券名；不可领解释原因不换券；切换列表重新展示；`getUserCoupons` 默认只查未使用 | ✅ 已修（4cb0df0c / 7b604e69） |

> **2026-11-23 修复进度**：A-1～A-6、A-8～A-13 已修；A-7（双重确认）与生产 OTP 固定码留待产品决策。逐条状态见 [审计 §7](./system-review/2026-11-22-ai-customer-flow-audit.md)，手工回归清单见 [2026-11-23-ai-customer-manual-regression](./system-review/2026-11-23-ai-customer-manual-regression.md)。
---

## 每次开工前的 3 个问题

1. 今天动的是 T 几？**不要跨级做**。
2. 这件事改完，我能说出一句带数字的话吗？说不出来就先补度量。
3. 改完跑 `yarn workspace @lucky/api tsc --noEmit --pretty` 了吗？

---

## 已知会踩的坑

| 坑                                      | 说明                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 行号会漂移                              | #85 的行号基于 2026-11-11 工作区，改文件后以内容搜索为准                                                                                                                                                                                                               |
| `state.spec.ts` 是自证测试              | 它测的是本地复制的 reducer，不是生产代码。补测试别照抄这个模式                                                                                                                                                                                                         |
| `prompt-resolver` 是 replace 不是 merge | 改 prompt 前先看 DB 里 override 是否只写了部分字段                                                                                                                                                                                                                     |
| OTP 有两个 TTL                          | `otp.service.ts` 300s、`ai-action-confirm.service.ts` 60s，改一个必须看另一个（T1-2 洞 2）                                                                                                                                                                             |
| 两个过期单测                            | `auth.service.spec.ts` 断言 `github` 非法（代码已支持）、`flash-sale.service.spec.ts` 断言少一个返回字段；都是测试没跟上代码，**不是产品 bug**。跑全量会看到 2 suites / 3 tests 失败                                                                                   |
| 故障注入只在非生产                      | `__CHAOS__` 前缀 + Redis `ai:chaos:fail`；跑完记得 `DEL`（脚本会自动清），生产 `NODE_ENV=production` 物理隔离                                                                                                                                                          |
| 领券限领是**隐式锁**                    | `claimCoupon` 的限领判断依赖「扣库存 `updateMany` 在前」——锁是那条 `UPDATE` 加的，不是代码里显式要的。顺序对调 = T1-6 复活，`coupon.service.spec.ts` 的顺序探针会红。别在这两段之间插入任何慢操作（外部 API / LLM），否则锁被长时间持有，Prisma 事务 5s 超时报 `P2028` |

---

## 参考

| 文档                                                   | 用途                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `docs/AI-joymini/85-生产化差距审计与企业上线清单.md`   | 问题台账（P0/P1/P2 + 证据 + 修复方案）                                               |
| `docs/AI-joymini/86-岗位匹配度评估与两周补齐路线图.md` | 打分、JD 对照、面试素材                                                              |
| `docs/AI-joymini/92-求职准备与业务下一步.md`           | 求职定位、讲解练习、业务缺口排序（G1–G6）                                            |
| `docs/AI-joymini/93-确认链路三个洞-SDD.md`             | T1-2 修复规格：先撕票/两张票/手搓 DTO                                                |
| `docs/AI-joymini/94-意图准确率基线-T0-3.md`            | 意图准确率的度量口径与首次基线                                                       |
| `docs/AI-joymini/95-提现冻结状态机-SDD.md`             | T1-3 修复规格：单一结算出口 + 状态 CAS + 账目不变式                                  |
| `docs/AI-joymini/96-OTP生产化-SDD.md`                  | T1-1 修复规格：fail-closed、pepper 启动校验、SmsProvider 抽象                        |
| `docs/AI-joymini/97-项目全景评估与落地清单.md`         | **全景评估**：42 项能力总账、落地三档、剩余 14 项难度与顺序                          |
| `docs/AI-joymini/98-转人工闭环-SDD.md`                 | T2-5 修复规格：状态机 + 认领 CAS + SLA 扫描 + **G6（T1-4 把客服 join_chat 挡住了）** |
| `tools/eval/`                                          | 回放工具（`run-replay.sh`）与基线文件                                                |
| `docs/AI-joymini/91-一条消息的旅程.html`               | 调用链主干 7 框，读懂代码的地图                                                      |
| `docs/coding-standards.md`                             | 9 维度检查                                                                           |
| `docs/AI-joymini/81` / `83` / `84`                     | 确认卡片设计与历史差距                                                               |

---

## 当前进度（2026-11-23，新窗口从这里接着做）

**分支**：`feat/ai-ops-operator-console`

**已完成并提交：**

| 提交 | 内容 | 结果 |
|---|---|---|
| `b61b6850` | E-17 意图边界重划 + 每域真实问法 + `generalDominates` | 标准集 86.9%→99.4%，真实集 62.8%→97.7%，盲测首跑 80.4% |
| `873732f7` | E-20 RAG 相关性门槛按文字系统校准 + 词面锚点 | 129 题负样本 1/20→0/20；66 题 10/12→5/12；Hit@1 未动 78.9% |

**当前指标**（`docs/system-review/2026-11-23-ai-eval-matrix-and-findings.md` §5.1–§5.2.2）：

- RAG 129：Hit@1 78.9% / Hit@3 97.2% / MRR 0.878 / p95 1563ms / 负样本 0/20（与 11-19 同口径基线持平或更好）
- RAG 66（真实问法）：Hit@1 74.1% / Hit@3 90.7% / 负样本 5/12（剩余全是注入/越权写操作）
- 意图 153：99.4%；真实 43：97.7%
- 全量测试 132 suites / 1163 tests 通过（E-11 新增 RAG 门卫 4 条 + provider 降级 3 条）

**E-11 已收口（2026-11-23，提交 `103f2ece` + `d9ff5de6` + n09 修复）**：不是 embedding/index 版本漂移。「85.0%」是 40 题子集（`20261119-143736.json`）；129 题同口径基线就是 78.9%。修掉的三个真问题（详见 eval matrix §5.1.3）：

- r53「中奖后怎么领奖」向量第 1（余弦 0.6464）被 CJK 门卫误杀 → 新增 `RAG_CJK_VECTOR_ANCHOR=0.60` 第三证据（63 正样本最低 0.560 / 16 负样本最高 0.598）
- Jina 对 r53 只给 0.0010，通用地板 0.03 在 CJK 分支前就拒 → 地板并入中文分支，**地板以下只认向量锚点**（关键词命中不能越过地板，否则 n09 泄漏）
- Jina 日配额耗尽后 embedding 余弦被当 reranker 用（量纲错配，负样本 20/20 泄漏）→ `OllamaProvider.rerank()` 不再兜底，返回 null 走 RRF

复跑结果（`20261123-164203.json` / `20261123-164716.json`）：129 题 **78.9 / 97.2 / 0.878 / p95 1563ms / 负样本 0/20**；66 题 **74.1 / 90.7 / 0.812 / 负样本 5/12**；layers 归因补齐（vector 100%）。

**下一步（按优先级）：**

1. **E-19**：Taglish RAG Hit@1 74.1%，order 58.3% / wallet 50%
2. E-20 剩余 5 条转注入防护/动作策略层，不要继续压检索地板
3. E-21/E-22 Taglish 物流与充值记录

**复跑命令：**

```bash
tools/eval/rag/run-replay.sh                                        # 129 题
tools/eval/rag/run-replay.sh --golden tools/eval/rag/golden.realistic.jsonl  # 66 题
tools/eval/run-replay.sh --golden tools/eval/golden/intent.holdout4.jsonl    # 意图盲测
yarn workspace @lucky/api test && yarn workspace @lucky/api tsc --noEmit --pretty
```

**注意**：`tools/eval/rag/reports/` 下还有 4 个未跟踪的中间报告（134226/135003/141619/142204），是调参过程文件，未提交；`151722`（向量锚点校准）与最终复跑 `164203`/`164716` 已提交。`151722` 是 Jina 配额耗尽后的降级运行，只用于向量层校准，不能当作质量指标。
