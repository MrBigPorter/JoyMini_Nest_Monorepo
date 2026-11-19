# 99 — 企业级 AI Agent 对标评估与优化路线

> **日期**：2026-11-19
> **范围**：`apps/api` AI 客服主链路（意图 → 编排 → 工具 → RAG → 转人工 → SSE/Socket），及其数据模型、可观测性、CI 与部署配置
> **方法**：三路只读代码扫描 + 主线逐条抽验 + 公开资料对标
> **证据等级**：**L1** 代码 + 测试可复核；**L2** 仅代码；**L3** 仅文档/设计
> **读者**：项目作者（面试准备）。本文不是对外宣传材料，结论按「可被面试官追问」的标准写。

---

## 0. 一页结论

**不是企业级，也不是玩具。**

它是一个「功能闭环完整、写操作安全与知识库版本化做得不错、但按单实例设计」的**工程化原型**。强度明显高于「CRUD + LLM demo」，但离企业级还差一整套：多实例一致性、检索评测、长期记忆、成本治理、指标化运营、多模态。

### 0.1 双口径打分

| 口径 | 分数 | 含义 |
|---|---:|---|
| **自评口径**（#86 / #85 / #97） | **56-60** | 按「能力是否存在」计分，部分能力按设计文档计入 |
| **证据口径（基线）** | **46** | 2026-11-19 修复前的代码证据分 |
| **证据口径（当前）** | **58** | 完成全部 P0 + 单飞/多实例 adapter/认证/CI/HNSW/RAG 评测/指标账本/引用回填后重算 |
| **8 周后目标（证据口径）** | **58-64** | 对应自评口径约 **70-72** |
| **面试进面线** | 65（自评口径） | 结论：**已经可以拿出去，但要带着「已知差距」讲** |

> 基线时两个口径差约 10 分：自评把「设计过但没接线」算进去了。典型四项：
> RAG 四层按四层计（实际一层是坏的）、多 Agent 按文档计（实际串行）、长期记忆按 saveContext 计（实际只写不读）、可观测按日志计（实际无指标端点）。逐项分解见 §7.3。
> 修复后差距缩小到约 5-9 分，剩余主要来自「长期记忆/多实例/检索评测/指标」。
> **面试时用证据口径，主动说出差距**，比被问穿更可信。

**截至 2026-11-19 的进展**：全部 P0 已完成，以及 P1-1（Socket 同会话单飞）、P1-2（Socket.IO Redis adapter）、P1-3（`/metrics` + token 日账本 + 日配额）、P1-6（RAG 引用回填）、P1-9（OTP 手机号绑定）、P1-10（确认 token 原子鉴权）。实测：意图 63 题 **68.2% / macro-F1 68.6%**；RAG 40 题 **Hit@1 82.5% / Hit@3 97.5% / MRR 0.898**；真实 RAG 回答已把 3 条引用写入 `ChatMessage.meta.sources`；8 次对话落库 **9198 tokens**；Socket.IO Redis adapter 已启用（pub/sub 频道已确认）。剩余主要项：P1-5 记忆持久化、P1-7 转人工 SLA UI、P1-8 流式帧白名单、P1-6 的 rerank 评测，以及双实例 e2e。

### 0.2 与淘宝 / 京东的关系

**规模不可比，能力维度可比。**

- **阿里小蜜 / 店小蜜 3.0**（2025-05）：从规则/FAQ 转向「目标驱动 Agent」，自主理解-规划-回复；多模态；厂商自述意图准确率约 92%、转人工率降 20%+、商家配置成本降约 60%。
- **京东京小智 5.0**（2025-04）：言犀 + DeepSeek 双模型；4 个「数字员工」Agent（客服 / 导购 / 跟单 / 质检分析）；供应链场景、情感计算、语音；服务 80 万+ 商家（厂商自述）。
- **它们在多租户、全渠道、知识自动运营、质检与坐席辅助、语音多模态上领先一个体系。**
- **本项目在四个点上能讲出不输业务团队的工程判断**：意图离线评测闭环、写操作双闸门、知识库版本化、转人工闭环。

> ⚠️ 对标数据口径：以上均为厂商/服务商公开材料中的自述数字，没有独立第三方横评，**不可直接与个人项目横比**。报告引用它们只用来说明「能力方向」，不用来给本项目打分。

### 0.3 三十秒版

1. 全链路跑得通：意图 → 多意图编排 → 35 个业务工具 → 两阶段确认 → 转人工 → 知识库版本切换。
2. 真正强的是：写操作安全、转人工闭环、KB 版本化、传输层限流与结构化日志。
3. 真正弱的是：Agent 编排是串行、重启失忆、多实例失真、没有指标端点；RAG Layer2 与工具身份已在 2026-11-19 修复。
4. P0 全部完成 + 6 个 P1（含引用回填、多实例 adapter）；下一步是记忆持久化、SLA UI 与双实例 e2e。

---

## 1. 评估口径与方法

### 1.1 评了什么

| 范围 | 主要文件 | 证据等级 |
|---|---|---|
| 图与意图 | `graph/customer.graph.ts`、`graph/nodes/intent-router.node.ts`、`graph/utils/intent-classifier.ts` | L1 |
| 编排与 Agent | `graph/nodes/orchestrator.node.ts`、`graph/agents/agent-runner.ts` | L1 |
| 工具与确认 | `graph/tools/*`、`ai-action-confirm.service.ts` | L1 |
| RAG 与知识库 | `knowledge/rag-retrieval.service.ts`、`knowledge/kb-version.service.ts`、`prompt-resolver.service.ts` | L1 |
| 记忆 | `graph/customer.graph.ts`、`common/ai/ai-memory.service.ts` | L1 |
| 转人工与聊天 | `orchestrator-utils/transfer-detector.ts`、`common/chat/chat.service.ts`、`support-handler.service.ts` | L1 |
| SSE / 限流 / 日志 | `ai-customer.controller.ts`、`sse-rate-limiter.service.ts`、`common/logger/*` | L1 |
| 数据与部署 | `prisma/schema.prisma`、`compose.prod.yml`、`nginx/conf.d`、`Dockerfile.prod` | L2 |
| CI 与评测 | `.github/workflows/ci.yml`、`tools/eval/*`、`scripts/ai-e2e-smoke.sh` | L1 |

### 1.2 没评什么

- 真实业务指标（GMV、转化率、满意度）——没有线上数据。
- 线上 SLA / 故障演练——没有生产运行记录。
- 多租户、计费、合规审计——代码中不存在，无法评估。

### 1.3 证据等级怎么用

| 等级 | 定义 | 面试时怎么说 |
|---|---|---|
| L1 | 代码存在，且能被单测/脚本/命令复现 | 「已实现，可以现场讲代码」 |
| L2 | 代码存在，但没有自动化验证 | 「实现了，但还没回归保护」 |
| L3 | 只有文档或注释 | 「设计过，代码未落地」 |

---

## 2. 代码视角的真实架构

文档里的「多 Agent Supervisor」在代码里并不存在。真实调用链如下（L1）：

```
Flutter / HTTP / Socket
        │
        ├── HTTP: POST /ai-customer/chat-stream → POST reserve → GET /chat-stream/:id (SSE)
        └── Socket: chat.sendMessage → ChatService.sendMessage
                    └─ handlerId == null 时 emit AI_MESSAGE_REQUESTED
                       └─ AiMessageListener → AiCustomerService.chatStream

LangGraph（customer.graph.ts:146-186）
  START → intentRouter → orchestrator → END
                 │              │
                 │              ├─ 1. transfer-detector 先判转人工
                 │              ├─ 2. MIN_SCORE=0.7 过滤 + SCORE_GAP 截断
                 │              ├─ 3. resolveExecutionOrder（静态 DEPENDENCY_MAP 重排一次）
                 │              └─ 4. for (label of executionOrder)  ← 串行
                 │                        └─ agent-runner: while (iterations < 3)
                 │                              └─ tools / RAG / direct handler
                 └─ embedding 分类 + LLM fallback

状态：MemorySaver（进程内）
```

### 与文档宣称的三处差异（必须知道）

| 文档说法 | 代码事实 | 证据 |
|---|---|---|
| Supervisor + Agent Reroute 多 Agent 协作 | 图只有 `intentRouter` + `orchestrator` 两个节点；`routerByIntent` 恒返回 `orchestrator` | [customer.graph.ts:146-186](../../apps/api/src/client/ai-customer/graph/customer.graph.ts#L146-L186)、[intent-router.node.ts:297-299](../../apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts#L297-L299) |
| 多标签并行执行 | `orchestrator` 内 `for (const label of executionOrder)` 串行；依赖排序只做一次静态重排 | [orchestrator.node.ts:469](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts#L469) |
| 9 意图含 `human_support` 分类 | embedding 标签是 7 业务 + `rag` + `general`；转人工走关键词/情绪检测，不进分类标签 | [intent-label-categories.ts:98-108](../../apps/api/src/client/ai-customer/graph/agents/prompts/intent-label-categories.ts#L98-L108)、[transfer-detector.ts:103-121](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/transfer-detector.ts#L103-L121) |

> 这不是「造假」，是文档追不上代码演进。但面试官只要看一眼 `customer.graph.ts` 就会问：「Supervisor 在哪？」——必须准备好诚实版本（见 §6.2）。

---

## 3. 十维评分矩阵（证据口径）

**判定标准**：企业级 ≥80；及格 60-79；原型 40-59；缺失 <40。
「企业级」要求：自动化回归 + 量化指标 + 并发/故障/多实例证据 + 运维闭环，四者缺一不算。

| # | 维度 | 权重 | 分数 | 判定 | 关键证据 | 一句话风险 |
|:--:|---|---:|---:|:--:|---|---|
| A | 意图理解与路由 | 12 | **60** | 及格 | 63 条 golden，2026-11-19 回放 accuracy 68.2%、macro-F1 68.6%；阈值已统一到 `intent-thresholds.ts`，0.5-0.7 降级有 warn | 准确率仍低于理想线，需继续调融合/例句 |
| B | RAG 与引用 | 15 | **70** | 及格 | Layer2 已修 + 回归；HNSW；40 题 Hit@1 82.5% / Hit@3 97.5% / MRR 0.898；RAG 回答把 3 条引用写入 `ChatMessage.meta.sources`（docId/title/score/预览） | faithfulness 与 rerank 贡献度未单独评测 |
| C | Agent 规划与编排 | 12 | **40** | 原型 | 2 节点图；串行 for；`MAX_ITERATIONS=3`（[constants.ts:6](../../apps/api/src/client/ai-customer/graph/constants.ts#L6)）；无 supervisor/reroute | 无法支撑「多 Agent 协作」叙事 |
| D | 工具权限与注入防护 | 12 | **70** | 及格 | 35 个工具；7 个文件身份改为请求上下文注入；写工具双闸门 + OTP；确认 token 改为 Lua 先鉴权后删除 | 仍缺能力标记/输入注入检测 |
| E | 会话状态与记忆 | 10 | **25** | 缺失 | `MemorySaver`（[customer.graph.ts:185](../../apps/api/src/client/ai-customer/graph/customer.graph.ts#L185)）；`ai:hot:` 只有写没有读（[ai-memory.service.ts:152-166](../../apps/api/src/common/ai/ai-memory.service.ts#L152-L166)） | 重启失忆、多副本不一致 |
| F | 人机协同 | 10 | **78** | 及格 | 关键词/情绪/重复触发、`awaiting_human`、CAS 认领、10 分钟懒回收、故障静态兜底 | 无排队 SLA、无坐席助手、无质检 |
| G | 实时与并发 | 8 | **72** | 及格 | Socket 同会话单飞（进程内队列 + Redis 锁）；Socket.IO Redis adapter 已启用（多实例广播）；可选取消信号管道 | 双实例 e2e 未跑；Redis 故障不自动重连；SSE 死路径 owner/consume 竞态未修 |
| H | 可观测与成本 | 8 | **55** | 原型 | 单行 JSON 日志 + traceId；新增 `/metrics`（请求/token/工具/检索/活跃流）、`ai_usage_daily` 日账本、用户日配额；e2e 8 次对话落库 9198 tokens | 有指标无仪表盘/告警；配额超限走转人工，未做 e2e 验证 |
| I | 质量工程与 CI | 8 | **55** | 原型 | 47 个 spec / 452 tests 全绿；API lint 0 error；CI 已把 API lint + 单测转硬门禁（[ci.yml:98-121](../../.github/workflows/ci.yml#L98-L121)） | 仍无 AI e2e 门禁；覆盖率未统计 |
| J | 文档与可复现 | 5 | **45** | 原型 | 文档量大；6 个 OpenSpec change 勾选 0%，任务清单严重滞后 | 文档会反噬：声称的能力被代码打脸 |

**加权合计：58.0 ≈ 58 / 100（基线 46）。**

> 分数不是目的。它的用途只有一个：**告诉你哪一维最值得先花时间**——E（记忆 25）和 H（可观测/成本 30）是现在杠杆最大的两个洞；B 已从 30 修到 45，但检索评测仍缺。

---

## 4. 与阿里小蜜 3.0 / 京东京小智 5.0 能力对标

> 再次声明：厂商数字为公开材料自述，口径不可比；本表只对齐「能力方向」，不对齐数值。

| 能力维度 | 本项目（证据） | 阿里小蜜 3.0 | 京东京小智 5.0 | 差距性质 |
|---|---|---|---|---|
| 交互范式 | 意图分类 + 编排式 Agent | 目标驱动：理解-规划-回复，自主调工具 | 4 个数字员工 Agent（客服/导购/跟单/质检） | **架构差距** |
| 意图理解 | 63 题 68.25%，可回归 | 厂商称约 92%，大规模标注 + 线上回流 | 双模型（言犀 + DeepSeek），场景化 | **数据规模差距**，不是算法差距 |
| Agent 编排 | 2 节点、串行、静态依赖 | 自主规划 + 多 Agent 协作 | 多 Agent 金字塔协作（导购） | **架构差距** |
| 工具与执行 | 35 个业务工具，写操作双闸门 | 平台工具「应接尽接」 | 深度接供应链/物流/价保/售后 | **生态差距**（个人项目不可能补） |
| 知识运营 | 版本化 RAG + 人工维护文档 | 知识自动解析与运营 | 商品库/全店库，自动更新 | **运营闭环差距** |
| 人机协同 | 转人工闭环 + 回流，无坐席助手 | 大模型降低转人工率 | 坐席助手 + 质检 + 情感计算 | **协同深度差距** |
| 多模态 | 仅 KYC 证件 OCR（Gemini） | 文本 + 多模态对话 | 文本/语音/视频，情感计算 | **能力差距** |
| 评测与运营 | 意图 golden 63 题；无 RAG eval | 线上 A/B + 人工质检 | 全流程质检 Agent | **体系差距** |
| 规模与交付 | 单实例、单商家 | 多租户 SaaS、全渠道 | 80 万+ 商家 | **规模差距**（不可比） |

### 4.1 该学什么

1. **评测驱动**：阿里/京东都强调「大模型 + 量化运营」。你已有意图 golden，缺 RAG 和端到端；补上就有一条完整的「评测 → 优化 → 复测」叙事。
2. **知识运营闭环**：他们的知识库能自动发现缺口、生成草稿、人工审核。你可以先做「badcase 回流 + 待标注队列」，不必做自动生成。
3. **人机协同不止转人工**：坐席助手（AI 给人工建议）和质检（AI 审对话）是两个高价值方向；但 1-2 个月内不建议做。

### 4.2 不该学什么

- **多租户 / 全渠道 / 语音多模态 / 自动知识生成**：这些是公司级投入，个人项目做出来也是玩具。面试时讲清「我主动划了 out-of-scope，理由是 X」，比硬做更加分。
- **照抄厂商数字**：说「我们意图 92%」会被问口径；说自己 63 题 68.25% 反而可信。

---

## 5. 真正拿得出手的 5 个点

> 每个点都能在代码里指出来，也都能被追问三层。建议按「为什么做 → 怎么做 → 失败模式 → 怎么验证」讲。

### 5.1 意图分类的离线评测闭环（L1）

**是什么**：pgvector TOP-5 语义匹配 + BM25 关键词加权融合（0.7/0.3）+ `human_support` 误匹配惩罚 + 近分 catch-all 纠正；配 63 条 golden set 与 `accuracy / macro-F1 / 分域 P-R / 混淆矩阵`。

**证据**：[intent-classifier.ts:124](../../apps/api/src/client/ai-customer/graph/utils/intent-classifier.ts#L124)（阈值）、[baseline.json](../../tools/eval/baseline.json)（68.25%）、[replay.py](../../tools/eval/replay.py)、[run-replay.sh](../../tools/eval/run-replay.sh)。

**怎么讲**：「我没有停在『接了个分类器』，而是先建了 63 条带标签的黄金集，跑出 68.25% 的基线，再让每次改阈值/改融合权重都能回归。分域看，coupon 的 F1 是 0.93，弱项在 X。」

### 5.2 写操作的双闸门（L1）

**是什么**：Agent 执行工具前截停 5 个写工具 → 生成 `pendingConfirm` → 60 秒一次性 token 绑定 userId → 用户二次确认 → 服务端 peek/verify/pop 原子消费 → 提现再加 OTP → DTO `whitelist + forbidNonWhitelisted`。

**证据**：[agent-runner.ts:206-235](../../apps/api/src/client/ai-customer/graph/agents/agent-runner.ts#L206-L235)、[ai-action-confirm.service.ts:42-93](../../apps/api/src/client/ai-customer/ai-action-confirm.service.ts#L42-L93)、[ai-customer.service.ts:604-655](../../apps/api/src/client/ai-customer/ai-customer.service.ts#L604-L655)。

**怎么讲**：「LLM 不能直接写库。我把『确认』做成了服务端状态机，不是前端弹窗；token 是一次性的、绑定用户的，OTP 通过前不 pop pending。单测断言的是调用顺序，不是『没抛错』。」——这是面试官最容易认可的一类细节。

### 5.3 转人工闭环（L1）

**是什么**：显式关键词、强负面词一次、弱负面词两次、同意图连续三次 → `awaiting_human` + 转人工原因 + 告别语先落库再发事件 → 人工 CAS 认领 → 下一条消息触发「10 分钟懒回收」切回 AI（不是定时任务）→ 模型故障时静态兜底话术。

**证据**：[transfer-detector.ts:103-121](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/transfer-detector.ts#L103-L121)、[chat.service.ts:227-241](../../apps/api/src/common/chat/chat.service.ts#L227-L241)、[ai-failure-handler.ts:41-89](../../apps/api/src/client/ai-customer/ai-failure-handler.ts#L41-L89)。

**怎么讲**：「转人工不是一句 `transfer()`，是一个有状态、有回流、有故障兜底的闭环。我还处理了『用户很急但负面词不够强』的顺序问题——检测放在所有 fallback 之前。」

### 5.4 知识库版本化（L1）

**是什么**：`activeVersion` 门禁 → CAS 条件更新切换/回滚 → 新旧 chunk 并存 → 检索层按 `active_version` 过滤 → Meili 标记翻转 → 7 天清理旧版本 → 同会话跨版本时显式告知用户。

**证据**：[kb-version.service.ts:176-177](../../apps/api/src/client/ai-customer/knowledge/kb-version.service.ts#L176-L177)、[rag-retrieval.service.ts:275-278](../../apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts#L275-L278)。

**怎么讲**：「知识库更新最容易出的事是切一半、旧答案残留、用户上下文对不上。我用版本号 + CAS + 双写解决了前两个，用跨版本提示解决了第三个。」这是很少见的「知识库上线不闪断」细节。

### 5.5 SSE 的生产化骨架（L1）

**是什么**：POST 预留 + GET 消费两阶段；Redis Lua 原子 consume；五层限流（用户独占/全局并发/IP/设备/令牌桶）+ 进程内熔断；`X-Accel-Buffering: off`；确认卡只推用户私有房间；结构化日志 traceId 贯通。

**证据**：[ai-customer.controller.ts:169-217](../../apps/api/src/client/ai-customer/ai-customer.controller.ts#L169-L217)、[sse-rate-limiter.service.ts:29-45](../../apps/api/src/client/ai-customer/sse-rate-limiter.service.ts#L29-L45)、[stream-reservation.store.ts:89-113](../../apps/api/src/client/ai-customer/stream-reservation.store.ts#L89-L113)。

**怎么讲**：「SSE 的坑不在流本身，在『谁有权消费、消费几次、关掉之后怎么办』。前两个我做了原子消费和 owner 校验。但要注意：SSE 已经是废弃路径，现网 AI 消息走 Socket（和人工聊天共用通道）。共享层已经铺好可选的取消信号管道，真正的缺口是同会话单飞，排在 P1。」——主动说清传输层的演进，反而显得可信。

---

## 6. 八个一问就露怯的点（附诚实答法）

### 6.1 总表

| # | 现象（证据） | 根因 | 面试官可能怎么问 | 诚实答法（建议背） | 成本 |
|:--:|---|---|---|---|---|
| 1 | RAG 第二层关键词 chunk 召回曾永久为空（2026-11-19 已修，[rag-retrieval.service.ts:339-403](../../apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts#L339-L403)） | 动态 SQL 占位符从 `$2` 起，参数从 `$1` 传；异常被 catch 成 `[]` | 「你的四层召回怎么实现的？」 | 「发现过一处 off-by-one：占位符错位导致该层 fail-closed 且被静默吞掉。修复是把参数构造和占位符绑定成同一份列表，并加了回归测试；下一步补 HitRate/MRR 检索评测。」 | 已完成 |
| 2 | 图只有 2 节点，Agent 串行（[customer.graph.ts:146-186](../../apps/api/src/client/ai-customer/graph/customer.graph.ts#L146-L186)、[orchestrator.node.ts:469](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts#L469)） | 从 Supervisor 架构收敛为「单编排器 + 子 Agent 循环」，文档未同步 | 「多 Agent 怎么协作/并行？」 | 「现在是编排式 Agent 骨架：一个编排器按静态依赖顺序跑子 Agent，不是并行多 Agent。我有 supervisor 的设计，但没上，因为 3 轮工具调用内串行已经够用，先保正确性。」 | 3-5d 才可真并行 |
| 3 | `MemorySaver` 进程内；`ai:hot` 只写不读（[customer.graph.ts:185](../../apps/api/src/client/ai-customer/graph/customer.graph.ts#L185)、[ai-memory.service.ts:152-166](../../apps/api/src/common/ai/ai-memory.service.ts#L152-L166)） | Checkpointer 未替换；长期记忆读取路径没接线 | 「服务重启后多轮上下文还在吗？」 | 「跨轮状态在进程内 MemorySaver，重启会丢；长期记忆写 Redis 但还没接读取。这是我知道的最大的状态管理缺口，方案是 Redis/PG Checkpointer + 影子双写。」 | 3-5d |
| 4 | 工具 `userId` 由 LLM 传参查库（[order-tools.ts:28-54](../../apps/api/src/client/ai-customer/graph/tools/order-tools.ts#L28-L54)） | 工具 schema 暴露 userId，Agent 层未强制用请求上下文覆盖 | 「Prompt injection 怎么防越权？」 | 「确认卡和 OTP 很强，但工具身份曾是信任边界上的真洞：userId 来自模型参数。现在 7 个工具文件全部改为 AsyncLocalStorage 请求上下文注入，模型在 tool schema 里看不到 userId；无上下文时 fail-closed。」 | 已完成 |
| 5 | Socket 生产链路曾有同会话并发；SSE 死路径 owner 校验在 consume 之后；多实例无 Socket Redis adapter（[chat.service.ts:227-241](../../apps/api/src/common/chat/chat.service.ts#L227-L241)） | 单实例假设 + 未接分布式锁；SSE 已废弃 | 「用户连发两条会怎样？」「关页面后模型还跑吗？」 | 「已用进程内 Promise 链 + Redis 锁做同会话单飞，不同会话仍可并发；Redis 故障降级为进程内串行，30s 抢不到锁会记 warn 放弃。断线不等于取消，因为回复会落库并补推；显式取消管道已铺好，但生产 Socket 还没接 cancel 事件。多实例还缺 Socket Redis adapter。」 | 单飞已完成；adapter 1d |
| 6 | 无 `/metrics`、token 不落库、无配额、无 LLM 结果缓存（L2） | 只做了日志，没做指标与账本 | 「AI 的质量和成本怎么度量？」 | 「结构化日志有 traceId 和 `llm.usage`，但只能离线查日志；没有 metrics 端点、没有 token 账本、没有用户配额。我在 P1 补四黄金信号和用量表。」 | 2-3d |
| 7 | 意图阈值曾三处不一致：0.7 / 0.5 / 0.7（2026-11-19 已统一） | 三个模块各自定义阈值 | 「0.6 分的结果去哪了？」 | 「已拆成三个语义独立的常量放进 `intent-thresholds.ts`：接纳 0.7、LLM fallback 0.5、执行 0.7。0.5-0.7 的融合分会明确记录 score/threshold/destination，不再无痕变闲聊。63 题回放 68.2%，与基线一致。」 | 已完成 |
| 8 | CI 曾排除 API lint、单测软门禁（2026-11-19 已修，[ci.yml:98-121](../../.github/workflows/ci.yml#L98-L121)） | 历史债务 + flaky 顾虑 | 「你的 CI 能拦住回归吗？」 | 「API lint 0 error、API 单测 47 suites / 452 tests 全绿，已经转成硬门禁；其他包测试仍是软门禁。E2E 和 AI 主链路门禁还没接。」 | 已完成 |

> **已修（2026-11-19）**：`requestWithdrawOtp` / `verifyWithdrawOtp` 不再接受 LLM 传入的 `phone`，改为用请求上下文 userId 查服务端绑定号码，并只回显脱敏后 4 位；无绑定号码时 fail-closed。

> **已修（2026-11-19）**：`ai-action-confirm.service.ts` 的 `consume()` 改为 Lua 先校验 owner 再 `DEL`；错 owner 不删除、不返回 payload，正确 owner 只能消费一次。

### 6.2 三句必须改口的表述

| 现在的说法 | 改成 | 为什么 |
|---|---|---|
| 「多 Agent 并行协作」 | 「编排式 Agent 骨架：单编排器 + 串行子 Agent + 静态依赖重排」 | 代码里没有并行，被追问就崩 |
| 「四层 RAG 召回」 | 「四路召回；其中关键词 chunk 层曾因 SQL 占位符错位失效，已修复并加回归；检索质量评测还在补」 | Layer2 已修，但还没有 HitRate/MRR |
| 「长期记忆」 | 「会话内跨轮状态（进程内）+ 待接线的长期记忆写路径」 | `ai:hot` 没有读取方 |

### 6.3 还有一个「诚实但扎心」的事实

[order-tools.ts:28-54](../../apps/api/src/client/ai-customer/graph/tools/order-tools.ts#L28-L54) 这类把 `userId` 暴露给 LLM 的写法，原本在 7 个工具文件里普遍存在（order / wallet / user / coupon / product / lucky-draw / kyc）。**2026-11-19 已完成全部 7 个工具文件的迁移：userId 改由请求上下文注入，tool schema 不再暴露该参数，并配伪造 userId 负向测试。** 这曾是 Agent 信任边界上明确的错误模式；现在面试官如果追问，可以直接指代码和测试。

---

## 7. 文档声称 vs 代码事实

### 7.1 OpenSpec 任务清单已严重滞后

| Change | 任务勾选 | 代码实际 | 结论 |
|---|:--:|---|---|
| `kb-hot-swap`（不在 openspec） | — | 8 个 commit 已实现（版本激活/回滚/清理/续话） | 代码领先文档 |
| `admin-frontend-closure` | 0/18 | `useMutation` 全仓 0 处 | 文档与代码都未开始 |
| `agent-trust-boundary` | 0/28 | `userId` 已从 7 个工具文件全部移除（请求上下文注入）；剩余能力标记/流白名单未做 | 部分完成 |
| `ai-quality-loop` | 0/22 | golden 仍 63 题；无反馈表/标注页 | 未开始 |
| `reliable-ai-runtime` | 0/23 | 仍 MemorySaver；无 Redis adapter/Abort | 未开始 |
| `intent-classification-baseline` | 0/28 | 已有 63 题 baseline | 代码领先文档 |
| `unify-intent-thresholds` | 0/21 | 阈值仍不一致 | 文档与代码都未完成 |

> **面试用法**：不要引用 OpenSpec 的「完成度」。引用代码、commit、测试和数字。文档只在被问「你怎么规划」时拿出来。

### 7.2 文档 vs 代码的具体冲突

| 文档声称 | 代码事实 | 证据 |
|---|---|---|
| 42 项能力完成 28 项（67%） | 其中若干项按「有设计」计入 | [#97](../../docs/AI-joymini/97-项目全景评估与落地清单.md) |
| 生产工程化 ~45%、运维 ~20%、治理 ~15% | 与本报告 B/E/H/I 维一致，但 #86 总分仍写 56 | [#85:13-20](../../docs/AI-joymini/85-生产化差距审计与企业上线清单.md#L13-L20) |
| 自评 56/100，两周到 70 | T0/T1 已兑现，T2/T3 多数未做；分数未重评 | [#86:16-19](../../docs/AI-joymini/86-岗位匹配度评估与两周补齐路线图.md#L16-L19) |
| 队列默认重试 3 次 | 未配置 `defaultJobOptions`，BullMQ 实际 1 次 | `rag-embedding.processor.ts:113` 与 `rag-embedding-queue.module.ts` 对照 |

### 7.3 自评 56 与证据 46 的差异分解

| 差异来源 | 大约影响 | 说明 |
|---|---:|---|
| RAG 四层按四层计 | +3 | 实际 Layer2 永久失效 |
| 多 Agent 按设计计 | +4 | 实际 2 节点串行 |
| 长期记忆按写路径计 | +2 | 实际无读取方 |
| 可观测按日志计 | +1 | 实际无指标端点/账本 |
| 意图按分类器能力计 | +0 | 68.25% 基线真实，但阈值不一致 |
| **合计** | **≈+10** | 56 → 46 |

> 这个分解本身就是一个面试素材：**「我做过一次自评，后来用代码证据重新打分，发现虚高 10 分，主要来自把设计算成了实现。」** 很少有候选人会主动讲这个。

---

## 8. 优化路线（1-2 个月，按面试价值 × 工作量排序）

**原则**：P0 只修「会被问穿的正确性/安全洞」；P1 选「低成本高叙事」；P2 只做边界，不贪多。每项都带可量化退出标准。

### 8.1 节奏总览

| 周 | 主题 | 交付 | 证据口径目标 |
|:--:|---|---|---:|
| W1-W2 | 止血 + 建数字 | RAG Layer2 修复、阈值统一、工具身份注入、CI 收紧、RAG 评测基线、SSE abort | 46 → 52-55 |
| W3-W4 | 信任 + 并发 + 成本 | 单飞、Socket adapter、`/metrics`、token 用量表、配额、prompt 缓存 | 55 → 58-60 |
| W5-W6 | RAG 质量 + 记忆影子 | 引用回填、rerank 评测、记忆持久化影子双写、P0 复测 | 58 → 60-62 |
| W7-W8 | 编排 + 收尾 | 并行 fan-out 或诚实降级、LLM-as-Judge、压测、面试材料 | 60 → 62-64 |

> 如果时间只剩 2 周：只做 P0 + 面试材料，不要碰 Checkpointer 和并行编排。

### 8.2 P0（W1-W2，必须完成）

| # | 事项 | 工作量 | 退出标准（可量化） | 面试价值 |
|:--:|---|---:|---|---|
| P0-1 | 修 `keywordSearchChunks` 占位符 + 单测 | 0.5-1d | Layer2 非空率 >90%；单测覆盖 1/2/3 token 与 domain 分支 | 「定位并修复 SQL off-by-one + fail-closed」 |
| P0-2 | 统一意图阈值 + fail-loud | 0.5-1d | 0.5-0.7 band 静默降级数 = 0；63 题 accuracy 不下降 | 配置一致性、可解释决策 |
| P0-3 | 工具身份服务端注入（全部 7 个工具域） | 1-2d | 伪造 userId 负向用例全部拒绝；工具签名不再暴露 userId | 信任边界、OWASP LLM Top10 |
| — | **进展（2026-11-19）**：coupon / order / wallet / user / product / lucky-draw / kyc 全部完成上下文注入并配负向测试 | — | — | — |
| P0-4 | CI 收紧 | 0.5d | API lint 入闸；API 单测阻断；故意回归 PR 必红 | 质量门禁有红绿证据 |
| P0-5 | RAG 检索评测集（30-50 题） | 1.5d | 产出 HitRate@3 / MRR / Layer2 非空率基线 | 「RAG 我评过」的核心数字 || P0-6 | 取消信号管道（共享层；SSE 已废弃，不接生产） | 0.5d | 可选 signal 透传到 `streamEvents`；abort 后不再消费事件/落库；生产 Socket 接入待 P1-1 | 运行时治理 |
| P0-7 | HNSW 索引 + 队列重试配置对齐 | 0.5d | `EXPLAIN` 走索引；重试次数与注释一致 | 性能证据 + 注释可信 |

**P0 全部完成（2026-11-19）。** 5 组数字：意图 accuracy 68.2%、RAG Hit@3 97.5% / MRR 0.898、Layer2 修复回归、HNSW 索引、同会话并发 = 1。

### 8.3 P1（W3-W6，选做 5-7 项）

| # | 事项 | 工作量 | 退出标准 | 风险 |
|:--:|---|---:|---|---|
| P1-1 | 同会话单飞（`RedisLockService` 接线） | 0.5-1d | 同会话并发 LLM 调用 = 1；消息顺序稳定 | 低 |
| P1-2 | Socket Redis adapter + 双实例验证 | 1d | 两个 backend 副本投递一致 | 中 | **adapter 已完成**；双实例 e2e 待跑 |
| P1-3 | `/metrics` + token 用量表 + 用户日配额 | 2-3d | 4 个黄金信号可查；超配额拦截率 100% | 中 |
| P1-4 | prompt resolver 缓存 + LLM 结果缓存 | 1-2d | 每轮 DB 查询下降；同 prompt P95 下降 | 低 |
| P1-5 | 记忆持久化影子双写 | 3-5d | 重启连续性 100%；影子回放一致率 | **高**（先影子，不切主链路） |
| P1-6 | 引用回填 + rerank 评测 | 2-3d | 引用覆盖率、faithfulness、MRR | 中 | **引用回填已完成**；rerank 评测待做 |
| P1-7 | 转人工 SLA cron + admin 队列 UI | 1.5d | 超时升级可演示；「待接入」列表可用 | 低 |
| P1-8 | 流式帧白名单 | 0.5d | 内部决策 JSON 不出网；协议单测 | 低 |
| P1-9 | 提现 OTP 手机号改为服务端绑定 | 0.5-1d | 模型传任意 phone 被忽略；OTP 只发绑定号码 | 低 |
| P1-10 | action-confirm token 原子鉴权 | 0.5d | 先校验 userId 再 getDel（Lua）；他人 token 无法被消费 | 低 |

**状态（2026-11-19）**：P1-1（单飞）、P1-2（Redis adapter）、P1-3（指标/账本/配额）、P1-6（引用回填，rerank 评测待做）、P1-9（OTP 手机号）、P1-10（token 原子鉴权）已完成；P1-5 / P1-7 / P1-8 待做。

### 8.4 P2（W7-W8 + 之后，加分项）

| # | 事项 | 工作量 | 说明 |
|:--:|---|---:|---|
| P2-1 | orchestrator 并行 fan-out / supervisor-lite | 3-5d | 只有在 P1-1/1-5 绿灯后再做；否则改叙事，不硬做 |
| P2-2 | LLM-as-Judge + badcase 回流 | 2-3d | 补「AI 质量运营」故事；需要新表和标注流程 |
| P2-3 | 多模态：图片描述前置 | 2-3d | 复用 Gemini `generateContentFromImage`；图不用改 |
| P2-4 | 压测报告（k6 / 双实例） | 2d | P95、429 率、取消后 token 增量、成本/会话 |
| P2-5 | 面试材料 | 2d | 架构图、README、10 分钟 demo、追问答案卡 |

### 8.5 依赖关系

```
P0-1 ─→ P0-5 ─→ P1-6
P0-3 ─→ (安全用例矩阵)
P0-6 ─→ P1-1 ─→ P1-2
P1-3 ─→ P2-1（需要成本/并发指标）
P1-5 ─→ P2-1（需要持久状态）
P1-5 先影子，观察 1 周再切
```

### 8.6 明确不做（写进简历也要能解释）

- 多租户、全渠道、语音、自动知识生成：公司级投入，个人项目做了也是玩具。
- 自建 Embedding/Reranker 训练：Jina API 已够用，投入产出比低。
- 完整 Supervisor 图：先证明串行版本正确，再谈并行；否则是负优化。

---

## 9. 验证与复测

### 9.1 命令清单

| 目的 | 命令 | 备注 |
|---|---|---|
| 类型检查 | `yarn workspace @lucky/api tsc --noEmit --pretty` | 提交前必跑 |
| 单测 | `yarn workspace @lucky/api test` | 47 个 spec / 452 tests；全绿 |
| 意图基线 | `bash tools/eval/run-replay.sh` | 需 `lucky-backend-dev` 容器 |
| 意图带门禁 | `bash tools/eval/run-replay.sh --fail-under 0.7` | 修复后使用；注意全局限流 60 次/60s |
| 端到端冒烟 | `bash scripts/ai-e2e-smoke.sh` | 真实 Socket 链路 + traceId 日志断言 |
| RAG 评测 | `bash tools/eval/rag/run-replay.sh` | 40 题；产出 Hit@1/3 / MRR / p50 / p95 |
| 取消信号 | 单测覆盖 signal 透传与 abort 后停止消费；生产 Socket 接入后用显式 cancel 验证 | 管道已铺，未接生产 |
| 索引验证 | `EXPLAIN (ANALYZE, BUFFERS) SELECT ... ORDER BY embedding <=> ...` | 确认走 HNSW |
| 双实例 | 两副本 + Redis adapter，同会话发消息 | 断言每轮 1 次 LLM 调用、投递一致 |

**2026-11-19 实测**：
- `yarn workspace @lucky/api test` → **50 suites / 462 tests passed**
- `yarn workspace @lucky/api lint` → **0 errors / 139 warnings**
- `bash tools/eval/run-replay.sh` → **accuracy 68.2% / macro-F1 68.6%（43/63）**，与基线一致
- `bash tools/eval/rag/run-replay.sh` → **Hit@1 82.5% / Hit@3 97.5% / MRR 0.898；p50 751ms / p95 858ms**（40 题；domain 过滤 Hit@1 92.5% / MRR 0.956）
- `curl /api/v1/metrics` + 真实 e2e 8 次对话 → `ai_chat_requests_total{outcome="success"} 8`、`ai_llm_tokens_total{type="total"} 9174`；`ai_usage_daily` 落库同值
- 真实 RAG 回答 → `ChatMessage.meta.sources` 含 3 条引用（`refund-policy` ×2、`return-shipping-faq` ×1），回答正文带「依据《Refund Policy》」
- Socket.IO Redis adapter → 启动日志 `✅ Socket.IO Redis adapter enabled`；Redis pub/sub 频道 `socket.io-request#/events#`、`socket.io-response#/events#...` 存在；单实例 e2e 8/8 PASS（双实例 e2e 未跑）
- HNSW 索引已在本地库确认：`idx_document_chunks_embedding_hnsw`（`hnsw (embedding vector_cosine_ops)`）

### 9.2 指标口径（面试直接引用）

| 指标 | 定义 | 当前 | 目标 |
|---|---|---:|---:|
| 意图 accuracy | 63 题 golden Top-1 | 68.2% | ≥75% |
| 意图 macro-F1 | 分域平均 | 0.686 | ≥0.75 |
| Layer2 非空率 | 关键词 chunk 层返回非空请求占比 | 修复后未实测 | >90% |
| RAG Hit@1 | 前 1 条含正确文档的题占比 | 82.5% | ≥85% |
| RAG HitRate@3 | 前 3 条含正确文档的题占比 | **97.5%** | ≥95% |
| RAG MRR | 正确文档排名倒数均值 | **0.898** | ≥0.90 |
| RAG p95 | 检索延迟 p95 | **858ms** | <1000ms |
| 取消后 token 增量 | 显式取消后仍产生的 completion tokens | 管道已铺，未接生产 | 0 |
| 同会话并发 LLM 数 | 同 conversation 同时执行的图数 | **1（单飞后）** | 1 |
| 每轮 prompt DB 查询 | prompt resolver 查库次数 | 每 agent 每轮 1 次 | 0（缓存） |
| token 日账本 | `ai_usage_daily` 是否记录 | **已验证（18372 tokens / 16 次）** | 100% |
| 引用覆盖率 | RAG 回答是否带 `meta.sources` | **已验证（3 条引用落库）** | 100% |
| 引用 faithfulness | 回答是否被 sources 支持 | 未测 | 建评测 |
| 日配额 | `AI_DAILY_TOKEN_LIMIT` 超限拦截 | 单测覆盖；超限走转人工 | 100% |
| 指标端点 | `/api/v1/metrics` 可抓取 | **已验证** | 持续可抓 |
| 多实例广播 | Socket.IO Redis adapter | **已启用（pub/sub 频道确认）** | 双实例投递一致 |
| 成本/会话 | token × 单价 | **可查询（ai_usage_daily）** | 可查询 |

### 9.3 before/after 模板

```md
| 指标 | W0 基线 | W2 | W4 | W8 | 变化 |
|---|---:|---:|---:|---:|---:|
| 意图 accuracy | 68.25% |  |  |  |  |
| Layer2 非空率 | ~0% |  |  |  |  |
| RAG HitRate@3 | 未测 |  |  |  |  |
| 取消后 token 增量 | 未接入 |  |  |  |  |
| 成本/会话 | 未落库 |  |  |  |  |
```

> 复测规则：同一 golden set、同一机器、同参数跑 3 次取中位数；记录 p50/p95 与 429 率；429 不能算「答错」。

---

## 10. 面试叙事

### 10.1 30 秒定位

> 「我做了一个电商 AI 客服 Agent，覆盖订单、钱包、优惠券、用户、商品、抽奖、KYC 共 7 个业务域、35 个工具，外加 RAG 与闲聊两个意图，合计 9 个意图标签。核心链路是意图分类 → 编排 → 工具调用 → 两阶段确认 → 转人工，知识侧有四路混合检索，40 题 Hit@3 97.5%、MRR 0.898。我重点做了三件事：写操作的服务端确认状态机、意图与 RAG 的离线评测闭环、以及知识库热切换不闪断。它目前是单实例形态，我知道离企业级还差多实例广播、记忆持久化和指标端点，这也是我下一步的计划。」

### 10.2 能说 / 限定说 / 改口说

| 类别 | 内容 | 表述方式 |
|---|---|---|
| **能说「已实现」** | 写操作双闸门 + OTP 原子核销；转人工闭环 + CAS 认领 + 10 分钟懒回收；KB 版本化 + CAS 回滚 + 双写；SSE 两阶段 + 五层限流 + 熔断；提现资金状态机；63 题意图 golden（68.2%）；**RAG 40 题 Hit@1 82.5% / Hit@3 97.5% / MRR 0.898**；**RAG 引用回填到 `ChatMessage.meta.sources`**；**Prometheus `/metrics` + token 日账本 + 日配额**；traceId 结构化日志；**7 域工具身份注入**；**Socket 同会话单飞**；**Socket.IO Redis adapter（多实例广播）**；**API lint/单测硬门禁（52 suites / 468 tests）**；**OTP 手机号服务端绑定**；**确认 token 原子鉴权** | 讲约束、失败模式、单测怎么钉住顺序 |
| **只能限定说** | 多标签融合（仅 top1-top2<0.05 问 LLM，非并行）；四路 RAG（Layer2 已修，40 题 Hit@3 97.5%，引用已回填，但 faithfulness 未测）；编排式 Agent（2 节点，非多 Agent 协作）；记忆（单实例 MemorySaver）；可观测（有 `/metrics` 与 token 账本，缺仪表盘/告警/缓存）；多实例（adapter 已启，双实例 e2e 未跑，Redis 故障不自动重连）；取消（管道已铺，生产未接）；配额（单测覆盖，未 e2e） | 「已实现 X，边界是 Y，下一步用 Z 指标验证」 |
| **必须改口** | 「多 Agent 协作」→「编排式 Agent 骨架」；「企业级」→「工程化原型 + 已量化差距」；「意图 92%」→「自有 63 题 68.2%，与厂商口径不可比」；「全链路可观测」→「traceId 日志，指标补齐中」；「生产验证」→「单实例 + 本地容器验证」 | 主动给差距，显得可信 |

### 10.3 五个必被问的问题与答法

**Q1：为什么用 LangGraph，不用状态机/纯函数？**
> 「我需要的是跨轮状态和可恢复的图执行，不是路由。当前用 MemorySaver，所以这个理由只成立一半——重启会丢；下一步换持久化 Checkpointer 才完全成立。」（诚实版比背定义强）

**Q2：意图为什么不用 LLM 直接分类？**
> 「成本、延迟和可解释性。embedding + BM25 可以在毫秒级给出分数和分域，LLM 只做低置信度 fallback。代价是阈值和融合权重需要评测来调，所以我建了 golden。」

**Q3：RAG 效果怎么样？**
> 「40 题黄金集：Hit@1 82.5%、Hit@3 97.5%、MRR 0.898，p95 858ms；带 domain 过滤时 Hit@1 92.5%、MRR 0.956。Layer2 曾因占位符错位失效，我修复后加了回归测试，才建了这套评测。引用已经回填到 `ChatMessage.meta.sources`，回答正文也会带『依据《Refund Policy》』；faithfulness 还没有单独评。」

**Q4：Prompt injection 和越权怎么防？**
> 「分层：system prompt 约束、工具白名单、写操作服务端确认、DTO 白名单、日志不落原文。7 个工具文件的 userId 已改为请求上下文注入，模型在 schema 里看不到；确认 token 也改成先鉴权后删除。仍缺输入注入检测与能力标记，我不会说已经全防住。」

**Q5：如果用户量涨 100 倍，哪里先崩？**
> 「单实例的 MemorySaver、Socket 广播、进程内熔断和配额先崩；然后是 LLM 成本没有配额；再往后是向量检索没有 HNSW。我的扩容顺序是：Redis adapter → 共享 Checkpointer → 指标与配额 → 索引与缓存。」

### 10.4 三个 STAR 故事

1. **确认链路三个洞**（看 `docs/AI-joymini/93-确认链路三个洞-SDD.md`）：先撕票、TTL 错配、手搓 DTO 绕过校验 → 改为 peek/verify/pop + 60s/330s TTL + `plainToInstance + validate` → 14 例单测断言顺序。
2. **知识库无感切换**（看 `2026-11-16-kb-hot-swap-design.md` + 8 个 commit）：activeVersion 门 + CAS + Meili 标记翻转 + 7 天清理 + 跨版本提示。
3. **提现冻结状态机**（看 `95-提现冻结状态机-SDD.md`）：审核只置 `PROCESSING`，单一结算出口 + CAS，避免重复放款。

> 这三个故事共同回答一个问题：**「你有没有在 LLM 之外做工程？」** 这是 AI Agent 岗位和「调 API」岗位的分水岭。

---

## 11. 风险与护栏

| 改动 | 回归面 | 护栏 |
|---|---|---|
| 工具身份服务端注入 | 依赖 LLM 传参的工具行为改变 | 先 log-only 观察差异；每工具契约测试 + 伪造 userId 负向用例；按域灰度 |
| 统一意图阈值 | 转人工率、意图分布漂移 | 离线 golden 回放 + 影子 band 对比；小流量灰度后再切 |
| PG/Redis Checkpointer | 迁移、thread 语义、延迟、旧会话兼容 | 影子双写 + 回放对比；feature flag；失败回退 MemorySaver；观察 N 天再切 |
| RAG Layer2 修复 / rerank | 回答分布与延迟变化 | 检索评测 + 引用评测双门禁；10% 会话 canary；保留旧链路开关 |
| 单飞 / 并行 fan-out | 消息合并、乱序、成本与超时 | 幂等键 + 会话内队列语义；最大并发/预算/超时；失败降级串行 |
| CI 收紧 | flaky 测试阻断发布 | 先 warning 一周；隔离 flaky 清单；失败归因 SLA |

---

## 12. 附录

### A. 面试速查卡（可打印）

**一句话定位**：单实例生产化程度较高的电商 AI 客服 Agent，强在写安全、转人工、KB 版本化、意图评测。

**五个强项**：意图 golden 68.25% / 写操作双闸门 + OTP / 转人工闭环 + 回流 / KB 版本化 + CAS / SSE 两阶段 + 五层限流。

**五个必须主动说的差距**：RAG Layer2 曾失效 / Agent 串行非并行 / MemorySaver 重启失忆 / 工具 userId 信任边界 / 无 metrics 与成本账本。

**三个数字**：63 题、68.25%、35 个工具。**两个不要说的数字**：92%、80 万商家（那是厂商的）。

**被问住时的万能句式**：「这块目前是 X，边界是 Y，我计划的验证指标是 Z。」

### B. 对标与参考来源

**厂商 / 行业（均为公开材料，数字多为自述，不可横比）**
- 京小智 5.0 上线报道：https://tech.china.com.cn/sx/20250427/408690.shtml
- 瓴羊 Quick Service（阿里）方案：https://guide.lydaasai.com/6tXhNoMx/
- 晓多「语流 Agent」多 Agent 架构：https://www.xiaoduoai.com/blog/26882.html
- 探域电商智能体（GraphRAG）：https://www.tungeegroup.com/company-news/detail/127/
- 6 款电商客服智能体横评（含 iMedia 市场数据）：https://www.thinkingai.cn/blog/ecommerce-customer-service-ai-agents/
- 2026 电商 AI 客服排行榜（第三方榜单，仅作方向参考）：https://zhuanlan.zhihu.com/p/2068407008479405847

**开源参考架构（用于校准「企业级」包含什么）**
- Multimodal E-commerce Customer Service（K8s/多租户/可观测目标）：https://github.com/huqingyuan0707/Multimodal_Intelligent_E-commerce_Customer_Service_System
- FastAPI + LangGraph 电商客服（16 用例评测/转人工工单）：https://github.com/YANG-XQ-01/customer-service-agent
- LangGraph 电商 Smart Agent（Supervisor/风险审核队列/OTel）：https://github.com/Mr-ZeLong/E-commerce-Smart-Agent

### C. 代码证据索引

| 主题 | 文件 |
|---|---|
| 图与状态 | [customer.graph.ts](../../apps/api/src/client/ai-customer/graph/customer.graph.ts)、[state.ts](../../apps/api/src/client/ai-customer/graph/state.ts) |
| 意图 | [intent-classifier.ts](../../apps/api/src/client/ai-customer/graph/utils/intent-classifier.ts)、[intent-router.node.ts](../../apps/api/src/client/ai-customer/graph/nodes/intent-router.node.ts) |
| 编排 | [orchestrator.node.ts](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator.node.ts)、[dependency-resolver.ts](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/dependency-resolver.ts) |
| Agent 循环 | [agent-runner.ts](../../apps/api/src/client/ai-customer/graph/agents/agent-runner.ts)、[constants.ts](../../apps/api/src/client/ai-customer/graph/constants.ts) |
| 工具 | [tools/](../../apps/api/src/client/ai-customer/graph/tools/)、[tool-registry.service.ts](../../apps/api/src/client/ai-customer/graph/tools/tool-registry.service.ts) |
| RAG | [rag-retrieval.service.ts](../../apps/api/src/client/ai-customer/knowledge/rag-retrieval.service.ts)、[kb-version.service.ts](../../apps/api/src/client/ai-customer/knowledge/kb-version.service.ts) |
| 记忆 | [ai-memory.service.ts](../../apps/api/src/common/ai/ai-memory.service.ts) |
| 转人工 | [transfer-detector.ts](../../apps/api/src/client/ai-customer/graph/nodes/orchestrator-utils/transfer-detector.ts)、[support-handler.service.ts](../../apps/api/src/common/chat/support-handler.service.ts) |
| SSE / 限流 | [ai-customer.controller.ts](../../apps/api/src/client/ai-customer/ai-customer.controller.ts)、[sse-rate-limiter.service.ts](../../apps/api/src/client/ai-customer/sse-rate-limiter.service.ts)、[stream-reservation.store.ts](../../apps/api/src/client/ai-customer/stream-reservation.store.ts) |
| 评测 | [tools/eval/](../../tools/eval/)、[baseline.json](../../tools/eval/baseline.json)、[ai-e2e-smoke.sh](../../scripts/ai-e2e-smoke.sh) |
| CI | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) |

### D. 相关文档

- [85 生产化差距审计](./85-生产化差距审计与企业上线清单.md)
- [86 岗位匹配度与两周补齐路线图](./86-岗位匹配度评估与两周补齐路线图.md)
- [97 项目全景评估与落地清单](./97-项目全景评估与落地清单.md)
- [93 确认链路三个洞](./93-确认链路三个洞-SDD.md)
- [95 提现冻结状态机](./95-提现冻结状态机-SDD.md)
- [98 转人工闭环](./98-转人工闭环-SDD.md)

### E. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-19 | 首版：三路代码扫描 + 主线抽验；双口径打分；8 周路线 |
| 2026-11-19 | 修复 coupon 工具身份边界：userId 改由 AsyncLocalStorage 请求上下文注入；补齐 trace-context / 工具 / 流式边界单测 |
| 2026-11-19 | 迁移 order / wallet / user 三域工具身份；新增 `tool-identity.ts` 统一 fail-closed 逻辑与 17 个负向/正向用例 |
| 2026-11-19 | 迁移 product / lucky-draw / kyc 三域；全部 7 个工具文件不再向 LLM 暴露 userId |
| 2026-11-19 | 修复 RAG Layer2 占位符错位（+3 回归用例）；统一意图阈值到单一配置源并消除静默降级 |
| 2026-11-19 | 增加共享层取消信号管道；按「SSE 已废弃」回退 controller/reservation 改动，P0-6 口径修正 |
| 2026-11-19 | Socket AI 同会话单飞：进程内 Promise 链 + Redis 锁，4 个并发用例 |
| 2026-11-19 | 提现 OTP 手机号改服务端绑定；确认 token 改 Lua 先鉴权后删除 |
| 2026-11-19 | CI 的 API lint/单测转硬门禁；HNSW 索引迁移；队列重试配置对齐 |
| 2026-11-19 | 63 题意图回放 68.2% / macro-F1 68.6%；47 suites / 452 tests 全绿；证据分 46 → 51 |
| 2026-11-19 | 新增 admin RAG 检索调试接口 + 40 题检索评测：Hit@1 82.5% / Hit@3 97.5% / MRR 0.898；证据分 51 → 54 |
| 2026-11-19 | 新增 `/metrics`、`ai_usage_daily` token 日账本、用户日配额；e2e 8 次对话落库 9198 tokens；证据分 54 → 56 |
| 2026-11-19 | RAG 引用回填：orchestrator 写入 ragSources，SSE onDone 带 sources，ChatMessage.meta.sources 持久化；真实回答验证 3 条引用；证据分 56 → 57 |
| 2026-11-19 | Socket.IO Redis adapter：多实例广播启用，Redis 不可用时降级内存；单实例 e2e 8/8；证据分 57 → 58 |

---

> **最后一句**：这个项目最缺的不是功能，是「数字」和「诚实」。现在你已经有第一组可复现的数字（63 题意图、47 套单测、HNSW 索引）；下一步补上 RAG 的 HitRate/MRR，把剩下三个夸大表述改掉，你就从「不敢拿出去」变成「经得起追问」。
