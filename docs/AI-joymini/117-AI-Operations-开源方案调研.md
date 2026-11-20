# 117 — AI Operations 开源方案调研

> 状态：调研稿
> 负责人：AI 平台
> 更新时间：2026-11-21
> 关联文档：[115 运营化设计](./115-AI-Operations-运营化设计.md)、[116 页面结构与 UI](./116-AI-Operations-页面结构与UI规范.md)、[114 质量 Admin 设计](./114-AI质量运营-Admin设计.md)、[118 验收评审与修复计划](./118-AI-Operations-验收评审与修复计划.md)
> 调研目的：为 AI Operations 的页面重组、数据模型和交互找可借鉴的开源模式；不直接替换现有系统

## 1. 调研结论

市面没有一个开源项目能完整替代 AI Operations。它们是按职责拆开的：

```text
Langfuse / Phoenix / Helicone  → 可观测、评测、成本
bull-board                     → 队列运维
LiteLLM / Portkey              → 网关、预算、限流
Chatwoot / agent-desk          → 客服队列、分派、SLA
Mem0 / Letta                   → 记忆浏览与治理
Flagsmith / Unleash            → 版本、环境、审计、回滚
NeMo / Guardrails / Promptfoo  → 安全护栏与红队
```

我们不应该自建一整套，而是：

```text
借数据模型
借交互模式
借安全边界
不借部署复杂度
```

## 2. Langfuse

### 2.1 它是什么

开源 LLM 工程平台，覆盖 tracing、prompt、eval、dataset、annotation、metrics。核心 MIT，企业目录单独授权。

### 2.2 核心模型

| 模型 | 用途 |
|---|---|
| Trace | 一次请求的完整链路 |
| Observation | span / generation / tool / retriever / chain 等步骤 |
| Score | 数值、分类、布尔、文本、修正 |
| Score Config | 评分维度定义 |
| Dataset / Dataset Item | 回归集 |
| Dataset Run Item | 一次评测运行中的用例结果 |
| Annotation Queue | 人工标注队列 |
| Prompt | Prompt 版本和标签 |

### 2.3 值得借

- **Score Config**：评分不是裸数字，有类型、分类、范围、描述。
- **Annotation Queue**：一次一条、状态、评审人、进度、键盘快捷键。
- **Trace / Observation 分层**：先看整条链路，再看某一步。
- **Dataset Run Item**：input / expected / metadata 分开。
- **指标 + 成本 + 延迟**：不是只统计 token。
- **merge-on-write 幂等**：事件排序、不可变身份、可变字段覆盖。

### 2.4 不借

- ClickHouse 全量分析栈
- S3 event staging / dual-write
- 多租户、AI Gateway、EE 功能
- 完整 self-host 运维复杂度

### 2.5 对我们的映射

| Langfuse | JoyMini |
|---|---|
| Trace | `AiTrace` |
| Observation | `AiSpan` |
| Score | `AiScore` |
| Score Config | `AiScoreConfig` |
| Annotation Queue | 质量待办 / 可选队列表 |
| Dataset | `AiEvalDataset/Case` |
| Dataset Run Item | `AiEvalResult` |

详见 [113 数据模型](./113-AI质量运营-数据模型.md)。

## 3. LangSmith

### 3.1 它是什么

LangChain 官方的商业 SaaS，做 tracing、eval、prompt、annotation queue。服务端不开源，self-host 是企业授权。

### 3.2 值得借

- Trace 与评测联动：从一条坏 trace 直接加入数据集。
- Annotation Queue 的 `Needs Review → Needs Others' Review → Completed`。
- pairwise 对比：两个版本并排选更好。
- 键盘快捷键和单条评审流。

### 3.3 不借

- 不作为运营后台
- 不把生产客服 PII 全量发到 SaaS
- 不依赖其闭源服务端

## 4. Braintrust

### 4.1 它是什么

eval-first 平台，强调 dataset / experiment / scorer / human review 闭环。

### 4.2 值得借

- **Human review 分三类队列**：triage、SME review、calibration。
- **expected 与 metadata 分离**：期望答案不要混参考材料。
- **评测结果按“新失败 / 已修复 / 仍失败”分组**。
- **人类评审与 LLM Judge 对齐**：用人工标签校准 judge。

### 4.3 不借

- 不引入其商业平台
- 不做完整 calibration 工作流（Phase 1）

## 5. Arize Phoenix

### 5.1 它是什么

OpenTelemetry 原生的开源 LLM 观测/评测平台，支持 trace、session、span annotation、dataset/experiment。

### 5.2 值得借

- trace 时间线/树状视图
- 按 session 聚合多轮对话
- span annotation 统一 HUMAN/LLM/CODE 来源
- OpenTelemetry 作为接入标准

### 5.3 不借

- 当前不引入 OTel collector / Phoenix 服务
- 不把运营页面做成 notebook 风格

## 6. bull-board

### 6.1 它是什么

Bull / BullMQ 的开源队列管理 UI。

### 6.2 值得借

- `readOnlyMode`：VIEWER 只能看
- `setVisibilityGuard`：按角色/租户限制队列
- 每个队列有业务描述
- Pause / Resume / Retry / Clean / Promote
- 操作后回显结果
- 队列卡片显示等待/活动/失败/延迟

### 6.3 不借

- 无内置认证：必须自己加 guard
- 默认展示所有队列：我们只展示 AI 相关
- Clean 不应该默认删 failed

### 6.4 对我们的启示

Runtime 页应该从“队列表”改成：

```text
AI 现在正常吗？
哪些用户消息没回复？
系统通道是否正常？
```

## 7. LiteLLM

### 7.1 它是什么

OpenAI 兼容的 LLM 网关，带 virtual keys、预算、限流、花费追踪。

### 7.2 值得借

- 预算层级：组织 / 团队 / 用户 / Key
- 周期预算与自动重置
- RPM / TPM 限流
- 花费与请求日志
- 管理后台的 spend / budget 视图

### 7.3 不借

- 不替换我们的 LLM 调用层
- 不引入新的代理层

### 7.4 对我们的启示

Usage 页要从“token 数字”升级为：

```text
用量 | 成本 | 预算
```

超限按天判断，不按区间总量。

## 8. Helicone

### 8.1 它是什么

开源 LLM 可观测/网关，强调零代码接入、请求日志、成本、缓存、限流。

### 8.2 值得借

- 按用户/团队的 cost attribution
- 成本阈值告警
- 延迟和错误看板
- 请求级日志与 session 分组

### 8.3 不借

- 请求级 tracing 较平，不能替代 span 树
- 商业路线有不确定性

## 9. Chatwoot / agent-desk / supportpilot

### 9.1 Chatwoot

开源客服平台，核心能力：

- 统一 inbox
- 自动分派（round-robin / capacity）
- 标签、自动化规则、宏
- 业务时间、CSAT、报表
- SLA 可能是企业版能力

值得借：

- 队列 + 负责人 + 标签 + 自动化
- 会话列表的优先级/等待时间
- 从 SLA 直接跳到会话

不借：

- 完整客服工单系统
- 多渠道路由

### 9.2 agent-desk / supportpilot

更贴近 AI 客服：

- AI-to-human handoff
- SLA 倒计时 P1–P4
- 人工审核队列
- 审计轨迹

值得借：

- 转人工队列要有负责人、原因、截止时间
- 不是只有趋势图

## 10. Mem0 / Letta / Graphiti

### 10.1 Mem0

- 记忆浏览器
- 搜索 top_k / threshold / explain
- 实体级联删除
- 记忆衰减 / 过期

### 10.2 Letta

- Agent Development Environment
- Context Window Viewer
- 可编辑 Core Memory
- Archival Memory 浏览器
- 记忆图/版本

### 10.3 Graphiti

- 时序知识图谱
- 适合 Zep 风格的时间化记忆
- 本身没有完整 dashboard

值得借：

- 按用户搜索
- 记忆来源
- 解释/置信度
- 软删/恢复
- 级联删除前的影响范围

不借：

- 引入向量图数据库
- 让运营手输 userId

## 11. Flagsmith / Unleash

### 11.1 值得借

- 版本 + 环境
- 审计日志：谁、何时、改了什么
- 一键回滚
- 变更原因
- 灰度/分段发布

### 11.2 对我们的启示

Flows 页应区分：

```text
切换流程版本（只改绑定）
回滚会话状态（改 checkpoint，不撤销业务副作用）
```

不能都叫 Rollback。

## 12. NeMo Guardrails / Guardrails AI / Promptfoo

### 12.1 NeMo Guardrails

- Colang DSL 定义对话边界、越狱、PII
- 输入/输出 rail
- 可接 Llama Guard / Presidio

### 12.2 Guardrails AI

- 输入/输出 validator
- PII、毒性、格式、竞品提及
- 校验失败自动重试

### 12.3 Promptfoo

- 评测 + 红队
- CI 门禁
- prompt injection / jailbreak 测试

### 12.4 共同现实

- 开源护栏通常**不带完整安全 dashboard**
- 需要和 observability 平台组合
- 安全事件应该有：规则、动作、处置状态

值得借：

- 事件 → 规则 → 动作（log / block / transfer）
- 确认攻击 / 标记误报 / 加入黑名单
- 红队报告进 CI

不借：

- 直接嵌入 Colang DSL
- 把安全页面做成原始事件表

## 13. 对比矩阵

| 能力 | 开源参考 | 借鉴 | 不借鉴 | 对应页面 |
|---|---|---|---|---|
| Trace / Span | Langfuse, Phoenix | 树状链路、session、span annotation | ClickHouse/OTel 全量栈 | Context、Runtime |
| Score | Langfuse | Score Config、类型、来源 | 裸 score | Quality |
| Annotation | Langfuse, LangSmith, Braintrust | 一次一条、rubric、进度、键盘 | 完整多租户队列 | 质量待办 |
| Dataset / Eval | Langfuse, Braintrust | expected/metadata 分离、运行对比 | 商业平台 | 回归测试 |
| Queue Ops | bull-board | readOnly、visibility、影响提示 | 无认证、全队列展示 | Runtime |
| 成本 / 预算 | LiteLLM, Helicone | 预算层级、spend、告警 | 新网关 | Usage |
| 客服队列 | Chatwoot, agent-desk | inbox、分派、SLA、负责人 | 完整工单系统 | Support |
| 记忆 | Mem0, Letta | 用户搜索、来源、软删、影响范围 | 图数据库 | Memory |
| 版本 | Flagsmith, Unleash | 版本、审计、回滚语义 | 新发布系统 | Flows |
| 安全 | NeMo, Guardrails, Promptfoo | 护栏、处置、红队 | 原始事件表 | Security |
| 洞察 | Langfuse dashboards | 趋势、对比、下钻 | 自定义 dashboard 引擎 | Insights |

## 14. 开源产品的现实限制

- 没有单一项目覆盖全部职责
- 自建 Langfuse 需要 ClickHouse / Redis / Postgres / S3
- bull-board 不自带认证
- Chatwoot 的 SLA 可能是企业版
- 很多护栏工具没有 dashboard
- 商业项目可能被收购/改 License，选型要留退出路径

## 15. 最终采纳决策

### 采纳

- Score Config + Annotation Queue 的交互
- Trace / Span 的数据模型
- Dataset / Experiment 的 expected 分离
- bull-board 的只读模式与影响提示
- LiteLLM 的预算/成本口径
- Chatwoot 的队列/负责人/SLA
- Mem0/Letta 的用户搜索与来源
- Flagsmith/Unleash 的版本审计语义
- NeMo/Promptfoo 的护栏和红队

### 暂不采纳

- ClickHouse / S3 staging
- 完整 Langfuse 自建
- LangSmith SaaS
- 完整工单系统
- 多租户
- 新向量图数据库

## 16. 来源

- Langfuse: https://github.com/langfuse/langfuse
- Langfuse docs: https://langfuse.com/docs
- LangSmith annotation queues: https://docs.langchain.com/langsmith/annotation-queues
- Braintrust human review: https://docs.braintrust.dev/annotate/human-review/index
- Arize Phoenix: https://github.com/Arize-ai/phoenix
- bull-board: https://github.com/felixmosh/bull-board
- BullMQ bull-board comparison: https://bullmq.io/articles/guides/bull-board-vs-taskforce/
- LiteLLM budgets: https://docs.litellm.ai/docs/proxy/users
- Helicone: https://github.com/Helicone/helicone
- Chatwoot: https://github.com/chatwoot/chatwoot
- Mem0: https://github.com/mem0ai/mem0
- Letta: https://github.com/letta-ai/letta
- Flagsmith feature versioning: https://docs.flagsmith.com/managing-flags/feature-versioning
- Unleash: https://github.com/Unleash/unleash
- NeMo Guardrails: https://github.com/NVIDIA/NeMo-Guardrails
- Guardrails AI: https://github.com/guardrails-ai/guardrails
- Promptfoo: https://github.com/promptfoo/promptfoo
