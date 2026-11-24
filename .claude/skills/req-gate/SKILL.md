---
name: req-gate
description: 当用户提出新需求、要新增或改动一个功能（"加个功能""加个接口""加个页面""做个小功能"）、需求还停在"要做什么"阶段，或说 new feature / add a feature / 需求澄清时使用；不要用于修 bug、重构、推进已有 OpenSpec change 的实现、纯可行性讨论（分别走 debugging、openspec-apply-change、business-analysis）。
user-invocable: true
allowed-tools: Bash(openspec:*), Bash(git status:*), Bash(git branch:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Read, Grep, Glob, Skill
---

# req-gate — 新需求入口闸门

你只决定「要做什么」和「边界在哪」，不决定「怎么做」，不写实现代码，不写任何文件。

## Non-Negotiable Rules

- R1 单向：分级 → 四问 → 差分 spec → tasks；交接后不回改已批准的 WHAT。
- R2 所有 WHAT 写成对 `openspec/specs/**` 的差分（ADDED / MODIFIED / REMOVED）；未提及的能力与 Requirement 一律视为不变。
- R3 只提醒不执行：实现并验证通过后必须 `openspec archive <name>`，否则 specs 与代码漂移。
- R4 执行层不产出 WHAT：`tasks.md` 每条任务必须引用一个 Requirement 名，引不上就停下。
- R5 L0 小改动直接走 PR 路径并退出，不套规格流程。

## Trigger

激活：用户提出新需求 / 要新增或改动功能 / 需求还停在「要做什么」/ 用户说 `/req-gate`。

不激活（各自有主，别抢）：修 bug → systematic-debugging；重构简化 → simplify；推进已有 change 的实现 → openspec-apply-change；纯可行性 ROI 讨论 → business-analysis。

与项目版 `superpowers` 同时命中时本 skill 优先：入口闸门先于执行。

## Phase 0 — Read-only Recon

只跑只读命令，不读实现代码（那是 design 的事），不写任何文件。

```bash
openspec list --specs --json
openspec list --json
openspec show "<candidate-id>" --type spec --json --no-scenarios   # 最多 3 个候选
git status --short && git branch --show-current && head -40 docs/current-task.md
```

## Phase 1 — Grade

| 等级 | 判定 | 典型 | 产出 | 下一步 |
|---|---|---|---|---|
| L0 | 无 spec 级行为变化：单文件/单接口的文案、参数、阈值 | 改错别字、调阈值、改配置、单字段校验修正 | 三行 PR 摘要 | 直接实现 + `/check` + PR，结束 |
| L1 | 一个现有 capability 的**新增**行为；单层；不改既有 Requirement 语义 | 新增只读接口、新页面字段、新导出格式 | WHAT 简报（ADDED 为主） | 交接 openspec-propose |
| L2 | 新 capability / 修改或删除既有 Requirement / 跨 ≥2 层 / 破坏性 / 新状态机或 schema | 新审核流、改计费规则、跨 api+admin+flutter | WHAT 简报 + design 约束 | 交接 openspec-propose |

平局与升级（照此判定，不临场发挥）：不确定 L0/L1 取 L1，不确定 L1/L2 取 L2；Q1 或 Q2 为「是」→ 至少 L2；Q4 结论是「新建 capability」→ L2。

分级结论必须**先给用户看并等一句确认**，不许自己往下走。

**L0 出口**：一条消息说完即停，不问四问——`问题`（一句话）/ `改动`（文件或接口级，不含设计）/ `验证`（一条可执行检查）/ 下一步：直接改 + `/check` + PR，不创建 OpenSpec change。

## Phase 2 — Four Questions

一次问完，允许用户答「全部默认」。

| # | 问题 | 追问信号 | 答「是」时简报必须补 |
|---|---|---|---|
| Q1 | 多实例 / 并发安全？ | 内存缓存、静态 Map、计数去重、锁、幂等键 | 一条并发 Requirement + 至少一个竞态或重复提交 Scenario |
| Q2 | 外部依赖失败怎么表现？ | LLM / Meili / Redis / 支付 / HTTP；超时、重试、降级、熔断 | 超时、不可用、部分成功的失败 Scenario + MUST NOT |
| Q3 | 状态成对且可回滚？ | create/delete、incr/decr、状态机、软删、补偿 | 对称操作 Requirement + 回滚/终态 Scenario |
| Q4 | 新建还是复用？ | 现有 specs 是否已覆盖；ADDED 还是 MODIFIED | 能力路径 + NEW/MODIFIED/REMOVED 结论 |

任一问题未答 → 不许交接。

## Phase 3 — Capability Delta Map

- 列出每个受影响 capability 的精确路径 + NEW/MODIFIED/REMOVED
- MODIFIED/REMOVED 必须引用既有 `Requirement:` 原名（从 `openspec show` 取，不改写）
- 未提及 = 不变（R2）
- 既有 spec 与已上线代码矛盾时，输出 `SPEC-DRIFT: <capability>/<Requirement>` 并强制本次一并处理，不许静默忽略
- 说不成「可观察行为」的，标 UNKNOWN 退回 Phase 2

## Phase 4 — WHAT Brief

只在对话里输出，不落文件。

```markdown
## WHAT Brief — <change-name>
- 等级：L1｜L2　原因：<一句话>
- 目标（Why）：<1-2 句用户可感知的问题>　变更名：<kebab-case，已确认无重名>
- 能力：`<new-capability-path>`（NEW）｜`<openspec/specs/path>`（MODIFIED）
- 范围外：<明确不做的事>　影响面：api｜admin-next｜flutter｜db｜ci
- 验收信号：<输入 → 可观察的输出/错误码/页面状态>

### Requirement Delta
| 类型 | Requirement | 行为（WHAT，可观察） | 场景（WHEN → THEN） |
|---|---|---|---|

### 边界四问
Q1 多实例 / Q2 外部依赖失败 / Q3 成对状态 / Q4 新建或复用 → 各自落到哪条 Requirement/Scenario，或划入范围外

### 假设与待决
- 假设：<已自行决定、不再询问的点>
- 待决：<必须为空才允许交接；否则退回 Phase 2>
```

不带文件清单、类名、分步实现——那是重复真源回来的路径。

结束语固定：「确认这份简报后，我交给 `openspec-propose` 生成 planning artifacts；只生成文档，不写实现。」

## Phase 5 — Handoff

```bash
# 1. 只读复核
openspec show "<capability-path>" --type spec --json --no-scenarios
# 2. 委派（唯一写入者）：Skill openspec-propose —— 由它跑 new change / status / instructions
# 3. 收尾复核
openspec validate "<name>" --strict && openspec status --change "<name>"
```

交接载荷（原文传给 openspec-propose）：

```text
change: <kebab-case name>
brief: <整段 WHAT Brief 原文>
constraints:
- 所有 WHAT 写成 delta；未提及 = 不变
- tasks.md 每条任务标注 [Req: <Requirement 名>]
- design.md 只讲 HOW；不把 HOW 塞进 delta spec
- 不生成 docs/superpowers/specs/** 或 docs/superpowers/plans/**
- 结束后运行 openspec validate "<name>" --strict
```

不要自己跑 `openspec new change`；名字重复时问用户是继续还是改名，不要覆盖。

## Forbidden

- 不写实现代码，不修 bug；不 archive
- 不新建 `docs/superpowers/specs/*` 或 `docs/superpowers/plans/*`
- 不在 L0 上创建 OpenSpec change；不为了「快点做」把 L1/L2 降级
- 不跳过四问；不把未回答的问题写成「默认」
- 不把文件路径、类名、库选择写进 delta spec（那是 design.md）
- 不自己写 proposal / specs / design / tasks

## Boundaries

| Skill | 负责 | 交接方式 |
|---|---|---|
| business-analysis | 可行性、ROI、工作量 | 先走它，回到 req-gate 出简报 |
| openspec-propose | 生成 proposal/specs/design/tasks | 唯一写入者，直接委派 |
| superpowers（项目） | 按已批准的 change 实现 | 交接后由它接手 |
| superpowers:brainstorming | 开放式发散想法 | 可当手段，出口仍是 WHAT 简报 |
| openspec-apply-change / archive-change | 实现与归档 | 后续阶段，不在此处 |
| check / jr-code-review | L0 与实现后的检查 | L0 出口指向它们 |

## Conventions

正文 zh-CN、结构标题英文；Requirement 名用中文，`SHALL / MUST / WHEN / THEN` 保持英文。先给结论，一次只问一组问题；用户催进度时压缩输出，不压缩四问。
