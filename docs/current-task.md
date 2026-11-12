# Current Task — 两周补齐计划（生产化 + 岗位就绪）

> 更新: 2026-11-12
> 依据: [#85 生产化差距审计](./AI-joymini/85-生产化差距审计与企业上线清单.md)、[#86 岗位匹配度与路线图](./AI-joymini/86-岗位匹配度评估与两周补齐路线图.md)
> 当前得分: **≈60 / 100**（2026-11-12 粗估；基线 56，待 T1 全部完成后按 #86 §10 重新逐维打分）

---

## 核心原则

**先建度量，再改代码。**
每个修复都要能说出一句话：「这条改动把 X 指标从 A 提到 B」。没有数字的改动，在面试里等于没做。

---

## 优先级队列（严格按顺序，不要跳）

### 🥇 T0 — 先做（Day 0-2）

| # | 任务 | 文件 | 产出 | 状态 |
|:--:|---|---|---|:--:|
| T0-1 | 提交工作区 16 个文件 | — | 基线 commit，`tsc --noEmit` 通过 | ✅ 2026-11-11 |
| T0-2 | 结构化日志：traceId + 意图 + 耗时 + token | 新建 `common/logger/`，埋点 `ai-customer.service.ts`、`orchestrator.node.ts`、`rag-retrieval.service.ts` | 一条对话可按 traceId 串起来 | ✅ 2026-11-11 |
| T0-3 | golden set + 回放脚本（Python） | 新建 `tools/eval/` | `tools/eval/run-replay.sh` 输出基线分 | ✅ 2026-11-12（63 题，准确率 68.2%，macro-F1 68.6%） |

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
> T1-2 闭环（2026-11-12）：`peek → verify → pop`（验码失败不再毁任务）、`TOKEN_TTL_SEC=60` / `PENDING_TTL_SEC=330` 拆开、`plainToInstance + validate` 真校验并拒多余字段。新增 `ai-action-confirm.service.spec.ts`（6 例）+ `ai-customer.service.spec.ts`（8 例）；`tsc --noEmit` 0 error，全量 300 passed（`auth` / `flash-sale` 两个已知过期 suite 除外）。

### 🥈 T1 — 安全与资金（Day 3-8）

| # | 任务 | #85 ID | 文件 | 状态 |
|:--:|---|:--:|---|:--:|
| T1-1 | 生产 OTP：接短信 + 启动校验 pepper + 去明文日志 | P0-4 | `client/otp/otp.service.ts` | ☐ |
| T1-2 | 确认链路三洞：验码后再删 / TTL 对齐 300s / 复用 DTO 校验 | P1-7/17/18 | `ai-customer.service.ts`、`ai-action-confirm.service.ts` | ✅ 2026-11-12（单测 14 例，见 [#93 §3.1](./AI-joymini/93-确认链路三个洞-SDD.md)） |
| T1-3 | 提现冻结状态机：审核只置 PROCESSING + `settleWithdrawal` | P0-3 | `admin/finance/finance.service.ts`、`client/wallet/client-wallet.service.ts` | ☐ |
| T1-4 | Socket 成员校验 + AI 会话 IDOR + `AI_CONFIRM` 改私有房间 | P0-1/2 | `events.gateway.ts`、`ai-memory.service.ts`、`ai-customer.service.ts` | ☐ |
| T1-5 | 领券原子扣减 + 唯一约束 | P0-5 | `client/coupon/coupon.service.ts`、`schema.prisma` | ☐ |

### 🥉 T2 — AI 质量（Day 8-9）

| # | 任务 | #85 ID | 文件 | 状态 |
|:--:|---|:--:|---|:--:|
| T2-1 | 转人工：词边界匹配 + 情绪分级 + 工单写入 + 消费者 | P1-19 | `transfer-detector.ts`、新增 admin 消费者 | ☐ |
| T2-2 | 意图阈值统一为单一常量 + 融合后再过滤 | P1-20 | `intent-classifier.ts`、`intent-router.node.ts`、`orchestrator.node.ts` | ☐ |
| T2-3 | RAG：中文分词 + Layer 2 占位符 + 向量相关性门槛 | P1-21 | `rag-retrieval.service.ts` | ☐ |
| T2-4 | 流式白名单：只转发 `answerSynthesizer`/`orchestrator` 最终文本 | P1-22 | `ai-stream.handler.ts` | ☐ |
| T2-5 | **转人工闭环**：admin「待接入」列表 + 订阅 `AI_TRANSFER` 通知 + 超时定时回收（现在只在用户下条消息时懒判定） | N-13 / N-14 | `admin/chat/`、`admin-next/.../customer-service/`、新增 cron | ☐ |
| T2-6 | **模型兜底**：`timeout 15s + maxRetries 1`；`degradeToHuman` 落固定话术 + 置 `awaiting_human` + 发 `AI_TRANSFER` + 记 `transfer{source:fallback}`；测试用故障注入（`__CHAOS__` 前缀 + Redis 开关，生产隔离） | N-15 | `graph/llm-factory.ts`、新增 `ai-failure-handler.ts` | ✅ 2026-11-12（单测 5 例 + E2E 第 9 场景实测，全套 9/9 PASS） |
| T2-7 | **成本限额**：按天聚合客服 token，超阈值降级转人工 + 记 `cost.guard`（复用 blog budget 写法） | N-16 | `ai-customer.service.ts`、新增 cost-guard | ☐ |

### 🏅 T3 — 收口（Day 10）

| # | 任务 | #85 ID | 状态 |
|:--:|---|:--:|:--:|
| T3-1 | 3 个集成测试：转人工 / 确认卡片 / RAG 降级 | P1-25 | ☐ |
| T3-2 | 复跑 golden set，出「改前 vs 改后」对比表 | — | ☐ |
| T3-3 | 更新 #86 §10 进度追踪（填真实分数） | — | ☐ |

### 🧊 T4 — 有余力再做

| 项 | #85 ID |
|---|---|
| 状态机版本 / 绑定切换 / 回滚 | 新增（JD 明确要求） |
| Outbox + 死信消费 + 消费端幂等 | P2-5 |
| 长期记忆（PG checkpointer + `saveContext` 落库） | P1-23 |
| PromptResolver 真合并 | P1-24 |
| AI 回复 `isAi` 标记 + 走 `MESSAGE_CREATED` | P1-1/2 |

---

## 每次开工前的 3 个问题

1. 今天动的是 T 几？**不要跨级做**。
2. 这件事改完，我能说出一句带数字的话吗？说不出来就先补度量。
3. 改完跑 `yarn workspace @lucky/api tsc --noEmit --pretty` 了吗？

---

## 已知会踩的坑

| 坑 | 说明 |
|---|---|
| 行号会漂移 | #85 的行号基于 2026-11-11 工作区，改文件后以内容搜索为准 |
| `state.spec.ts` 是自证测试 | 它测的是本地复制的 reducer，不是生产代码。补测试别照抄这个模式 |
| `prompt-resolver` 是 replace 不是 merge | 改 prompt 前先看 DB 里 override 是否只写了部分字段 |
| OTP 有两个 TTL | `otp.service.ts` 300s、`ai-action-confirm.service.ts` 60s，改一个必须看另一个（T1-2 洞 2） |
| 两个过期单测 | `auth.service.spec.ts` 断言 `github` 非法（代码已支持）、`flash-sale.service.spec.ts` 断言少一个返回字段；都是测试没跟上代码，**不是产品 bug**。跑全量会看到 2 suites / 3 tests 失败 |
| 故障注入只在非生产 | `__CHAOS__` 前缀 + Redis `ai:chaos:fail`；跑完记得 `DEL`（脚本会自动清），生产 `NODE_ENV=production` 物理隔离 |

---

## 参考

| 文档 | 用途 |
|---|---|
| `docs/AI-joymini/85-生产化差距审计与企业上线清单.md` | 问题台账（P0/P1/P2 + 证据 + 修复方案） |
| `docs/AI-joymini/86-岗位匹配度评估与两周补齐路线图.md` | 打分、JD 对照、面试素材 |
| `docs/AI-joymini/92-求职准备与业务下一步.md` | 求职定位、讲解练习、业务缺口排序（G1–G6） |
| `docs/AI-joymini/93-确认链路三个洞-SDD.md` | T1-2 修复规格：先撕票/两张票/手搓 DTO |
| `docs/AI-joymini/94-意图准确率基线-T0-3.md` | 意图准确率的度量口径与首次基线 |
| `tools/eval/` | 回放工具（`run-replay.sh`）与基线文件 |
| `docs/AI-joymini/91-一条消息的旅程.html` | 调用链主干 7 框，读懂代码的地图 |
| `docs/coding-standards.md` | 9 维度检查 |
| `docs/AI-joymini/81` / `83` / `84` | 确认卡片设计与历史差距 |
