# Current Task — 两周补齐计划（生产化 + 岗位就绪）

> 更新: 2026-11-11
> 依据: [#85 生产化差距审计](./AI-joymini/85-生产化差距审计与企业上线清单.md)、[#86 岗位匹配度与路线图](./AI-joymini/86-岗位匹配度评估与两周补齐路线图.md)
> 当前得分: **56 / 100**（进面 65，稳妥 70）

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
| T0-3 | golden set + 回放脚本（Python） | 新建 `tools/eval/` | `python replay.py` 输出当前基线分 | ☐ |

> 为什么先做这 3 件：没有 T0-2 看不到问题，没有 T0-3 证明不了修好了。
>
> T0-1 已完成（2026-11-11）：基线提交 `d1eda1b0` → `de8e8f0e`，含 #88 元数据合并、导入/校验 CLI、知识库批量上传、N-6 向量化健壮性修复；`tsc --noEmit` 0 error。
>
> T0-2 已完成（2026-11-11）：按 [#89 SDD](./AI-joymini/89-AI对话可观测性-SDD.md) 落地 `common/logger/`（`runWithTrace` / `emitStage`），埋 8 类事件；App 真实对话走 `AiMessageListener`（事件总线）而非 SSE 控制器，trace 在该入口生成。真实对话实测同 traceId 串起 5~7 条事件，`tokenTotal` 1275 / 1072 / 120，转人工 `transferred:true`；单测 11/11、全量 153/153。生产 Loki 验收（AC-9/AC-10）随发布进行。顺带修复 N-7（转人工被分数门槛短路）、N-8（三处日志泄露原文），遗留 N-9（Socket 重连不重放 `join_chat`）。

### 🥈 T1 — 安全与资金（Day 3-8）

| # | 任务 | #85 ID | 文件 | 状态 |
|:--:|---|:--:|---|:--:|
| T1-1 | 生产 OTP：接短信 + 启动校验 pepper + 去明文日志 | P0-4 | `client/otp/otp.service.ts` | ☐ |
| T1-2 | 确认链路三洞：验码后再删 / TTL 对齐 300s / 复用 DTO 校验 | P1-7/17/18 | `ai-customer.service.ts`、`ai-action-confirm.service.ts` | ☐ |
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
| OTP 有两个 TTL | `otp.service.ts` 300s、`ai-action-confirm.service.ts` 60s，改一个必须看另一个 |

---

## 参考

| 文档 | 用途 |
|---|---|
| `docs/AI-joymini/85-生产化差距审计与企业上线清单.md` | 问题台账（P0/P1/P2 + 证据 + 修复方案） |
| `docs/AI-joymini/86-岗位匹配度评估与两周补齐路线图.md` | 打分、JD 对照、面试素材 |
| `docs/coding-standards.md` | 9 维度检查 |
| `docs/AI-joymini/81` / `83` / `84` | 确认卡片设计与历史差距 |
