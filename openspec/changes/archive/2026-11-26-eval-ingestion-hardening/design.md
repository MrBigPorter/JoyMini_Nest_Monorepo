# Design

## Context

行为契约见 `specs/admin-ai/quality-loop/spec.md` 与 `specs/admin-ai/quality-console/spec.md`；动机见 `proposal.md`。本节只记录影响实现的现状事实。

判官链路是两条：外部 harness 调 `POST /v1/admin/rag/documents/judge`（`review` 走 `rag-faithfulness.service.ts`，实际模型由 `AI_LLM_TYPE` / `OLLAMA_MODEL` 决定，当前为 deepseek-chat，默认重复 3 次）；内部评测调 `POST /v1/admin/ai-eval/judge`（`ai-eval-judge.service.ts`，默认 Groq `llama-3.3-70b-versatile`，单次采样）。两条链路都经 `createLLM`（`graph/llm-factory.ts`），都以 `StringOutputParser` 收口，因此成功路径的 `AIMessage` 与 usage 都在收口处丢弃。

收录侧分两段：harness 在 `traces.applyGrounding` 里改写 `goldenAgreement` 并按 `external-sync.toExternalResult` 生成结果；服务端在 `ingestExternalResults` 里落 `ai_eval_results` 并由 `buildExternalSummary` 计算 summary。`run.summary` 是 JSON 列，没有列级 schema。

`@langchain/core` 1.2.1 / `@langchain/openai` 1.5.3 已提供 `withStructuredOutput`，`method` 支持 `functionCalling | jsonMode | jsonSchema`。

## Goals / Non-Goals

**Goals:**

- 把「没判过」与「判官失败」在代码里变成两个不可混淆的状态，且源头不再生产无法判读的中间态。
- 让覆盖率、判官尝试、用量三个观测面共享同一份 summary 与同一套事务边界。
- 所有新增能力在 provider 不支持或写入失败时可降级，不改变既有判分结论。

**Non-Goals:**

- 不改判官提示词的判分语义，只改解码约束与版本号。
- 不重算历史 run 的 summary；旧数据按「未记录」呈现。
- 不引入对象存储、消息队列或新的调度框架。

## Decisions

### D1 收录判定在两端各收一次口，而不是只在映射层兜底

源头 `applyGrounding`：kb 依据分支先看 `expectedDocIds` 是否非空。非空才重开 `applicable: true`（供后续补判）；为空则写 `applicable: false` + `reason: 'no_golden_documents'`，不再合成空壳。

映射层 `knowledgeVerdict`：按「结构化状态优先、文本猜测最后」排序——`applicable === false` → 不适用；布尔结论 → 对/错；有结构化 `errorKind` → 直接采用；reason 带 `judge_error` 前缀 → 兼容旧数据；其余残态 → 不适用并记录具体原因。

**为什么不在映射层单点兜底**：空壳在源头产生，任何下游消费者（补判筛选、报告分母、离线重判）都会各自遇到同一问题。**为什么不用 faithfulness 回退**：faithfulness 衡量「回答是否被自己引用的来源支持」，与「是否与 golden 一致」不是同一维度；负样本引用任意文档都可能被判为忠实，会把未答成记成答对，直接污染准确率分母。

### D2 覆盖率服务端单点计算，harness 只做对账副本

服务端 `buildExternalSummary` 从已入库结果计算 `judgedCases` 与 `coverage`（四位小数，零条为 `null`）；harness `summarizeExternalResults` 同步生成同名字段，仅用于 `compareSummaryWithRecord` 一致性复核。两侧必须使用同一舍入规则，否则对账会产生假告警。

命名选 `judgedCases` 而非 `judged`：`verdict3` 族已有 `judged`，含义是 `solved+partial+unsolved`，同名不同义会让跨族读取误判。

新增 summary 键必须在 `quality-contract.registry.ts` 的 `SUMMARY_KEYS` 登记，否则契约测试会红。

### D3 判官尝试独立成表，不塞进结果行

新表 `ai_eval_judge_attempts`：`run_id` 外键级联删除、可空 `case_id`、`source`（task / faithfulness / golden）、`attempt_index`、`outcome`（success / parse_failed / call_error）、解析结果字段、`error_kind`、`raw_output`（上限 4000 字符）、`raw_truncated`、判官版本与输入哈希、`created_at`；索引 `(run_id, case_id)` 与 `created_at`。

**为什么不加 `ai_eval_results` 列**：该表由 `getRun()` 用无 `select` 的 `findMany` 读取，新列会自动出现在所有角色的响应里（含 VIEWER），并让分页响应膨胀；按保留期清理也只能逐行置空。独立表可按时间批量删除、可单独收紧读权限。

**写入边界**：内部执行时尝试记录与结果行在同一事务内写入（有结果即有留痕）；写入失败只告警，不改判分与运行状态。外部 ingest 只接受运行中的 run，尝试记录与结果同批写入，不可后续回填。

**脱敏**：外部判官只对回答与来源脱敏，问题不脱敏；内部判官入参完全不脱敏，可能含地址与联系方式。因此原始输出落库前统一过 `redactPiiText`，且不写日志。

**体积**：现有 804 条尝试样本序列化后平均 562 字符、p95 1071、最大 1777；单条上限 4000 可覆盖全部样本。一次全量运行约 1–3 MB。

### D4 结构化输出用 jsonMode，并保留文本解析作为兜底

在两个判官服务内部各自构建 `withStructuredOutput(zodSchema, { method: 'jsonMode', includeRaw: true })`，不改造共享工厂。

**必须显式指定 `jsonMode`**：`@langchain/openai` 对非 `gpt-` 前缀模型在未指定 method 时默认使用 `jsonSchema`，DeepSeek 大概率返回 4xx。

**必须保留兜底**：框架的结构化解析器只接受整段 JSON 或围栏块，不接受「从第一个 `{` 到最后一个 `}`」的提取；直接替换会把当前能救回的带前后缀输出判死。流程为：结构化结果非空直接用；为空则走既有文本解析；再失败才记 `output_format`。

**zod schema 必须宽容**：不用严格模式拒绝未知字段，分值允许数字或数字字符串，数组字段可选；分值与条数裁剪仍在后处理完成，不依赖 schema 改变业务语义。

**开关**：新增环境开关（默认开启），关闭时退回纯文本模式。服务提供方拒绝结构化请求时按同类处理，不得让整链失败。

**版本**：解码约束变化必须上调判官版本号，否则运行快照无法区分「同提示词、不同解码约束」。三条 provider 路径（DeepSeek、Groq、本地 Ollama）需各做一次真实调用验证，其中本地路径不支持强制工具调用，故不采用工具调用方案。

**实测（2026-11-26，`rejudge.mjs --limit 20` 于 `20261126-013449` 的 kb 样本）**：结构化模式（`strict-v2`）20/20 无判官失败、逐次一致性均值 1.0；同一批样本的旧文本判定（`strict-v1`）同为 0 失败、1.0。期间后端日志无「structured … falling back」告警，说明请求确实走了 jsonMode 而非降级。结论：结构化没有把原本成功的输出判死。

### D5 用量用 LangChain callback 采集，分角色记账

新增一个窄的 collector，实现 `handleLLMEnd`：优先读消息的 `usage_metadata`，回退 `llmOutput.tokenUsage`，两者都没有则记一条「不可得」调用。collector 由调用方显式传入角色（chat / judge），挂在 `testChat` 的图调用与两处判官的 invoke 上，只在链的调用点挂一次，避免模型级与链级重复计数。

判官多次尝试各自独立 collector，聚合时求和；失败尝试不计 token 但计调用数。本地 Ollama 无用量，必须允许「不可得调用数大于 0」且不因此判定运行失败。

### D6 预算保留估算账本，新增真实账本

`estimatedTokens` 保留历史语义不变；新增 `real` 分账与 `budgetBasis`（`estimated-v1` / `real-ewma-v1`）。在真实用量可用时，按最近若干条用例的真实总量做指数移动平均并乘安全系数作为下一条的预测，取估算与预测的较大值；首个用例仍用估算。

现有估算公式只按题干长度与固定开销推算，未计入系统提示词、检索文档、多节点调用与判官提示词，真实用量会显著偏高；因此默认预算阈值必须同批重校准，否则既有运行会大面积超限。预算检查只能在用例边界执行。

外部运行不经过服务端执行循环，预算由 harness 自行约束；服务端只汇总并标注超限，不拒绝已完成的入库数据。

### D7 可比性校验从测试专用代码搬到生产模块

`quality-contract.registry.ts` 中已实现指标族、指标版本、判官版本、数据快照哈希、范围的校验，但按设计约定仅被测试引用。新建生产模块承载同一逻辑，注册表改为复用（或测试改引用），避免两份实现漂移。

`getRunDiff` 补齐两端的运行元数据查询后调用该校验；不可比时先返回原因列表而非直接 4xx（历史页面不应突然打不开）。同时补运行状态校验，运行中与失败的运行不参与稳定比较。

`getCaseHistory` 为每个时间点标注可比性与原因，避免不同快照的用例被串成一条翻转线。

翻转率定义：主指标只统计两次都得到布尔判定的用例，方向拆分为「变好 / 变差」，同结论但原始判定档位变化的单列；样本量随百分比一并返回，低于阈值标注低样本且不进门禁。当两次判官输入哈希与判官版本都一致时，额外标注「翻转更可能来自判官非确定性」。

### D8 前端沿用现有挂载点

外部运行摘要行与基线差异卡片是既有位置，只追加字段与文案，不新增请求参数、不新增页面。缺字段一律渲染「未记录」，不可回退到 0；不可比时展示原因并弱化差异数字。

## Risks / Trade-offs

- **provider 不支持结构化输出** → 开关可关闭，且 4xx 走降级路径；上线前对 DeepSeek、Groq 各做一次真实调用验证。
- **schema 过严把原本成功的输出判死** → schema 保持宽容 + 文本兜底；上线后对固定样本重判，比较判官失败率与一致性，确认没有把成功变失败。
- **原始输出含个人信息** → 落库前统一脱敏，读接口限 ADMIN 及以上，不进日志，按保留期清理。
- **留痕写入拖垮评测** → 事务内写；失败只告警，运行状态与判分不受影响。
- **DB 增长** → 单条上限 + 每日分批清理 + `created_at` 索引；保留期可配。
- **真实用量接入后运行大面积超限** → 采集与预算重校准同批上线；`budgetBasis` 让历史运行可解释。
- **外部运行缺判官身份字段**（现有创建路径未写判官模型与厂商） → 可比性校验把「缺失」与「不一致」分开处理，缺失只降级为警告，不直接判不可比。
- **不可比判定会让历史差异页面变灰** → 先返回原因列表并标注，不返回 4xx。
- **判官版本上调导致既有基线失效** → 迁移顺序中安排一次基线重跑，并在控制台标明版本切换点。

## Migration Plan

1. 先合并不依赖数据库的改动：收录判定穷尽化、覆盖率字段、可比性校验、前端展示。此步可立即解掉基线 promote 被虚假失败卡住的问题。
2. 数据库迁移新增尝试记录表与索引，随后上线留痕写入、只读接口与清理任务。表为新增，回滚只需停止写入。
3. 结构化输出与用量采集各自带开关上线，先只开启采集、观察一轮，再开启预算新口径；判官版本号在开启结构化输出时同步上调。
4. 版本切换后重跑一次全量运行，登记为新基线，旧基线保留但标注版本切换。

回滚：新增表与字段均可停止写入而不影响读取；开关关闭即退回原解码与估算路径；预算口径可通过 `budgetBasis` 与会话开关回退到估算。

## Open Questions

- ~~各 provider 对结构化输出的具体支持范围~~ **已确认（2026-11-26 真实调用，`apps/api/scripts/probe-judge-structured-output.ts`）**：
  - DeepSeek `deepseek-chat`：`jsonMode` 可用；`jsonSchema` 返回 400（`This response_format type is unavailable now`）。→ 必须显式 `jsonMode`，不能依赖框架对非 gpt 模型的默认取法。
  - Groq：`jsonMode` 与 `jsonSchema` 均可用，但仅对账号可访问的模型成立。编译期默认 `llama-3.3-70b-versatile` 对当前 key 返回 404 `model_not_found`；探测时以 `AI_EVAL_JUDGE_MODEL=openai/gpt-oss-120b` 通过。模型默认值是否随之调整另行决定，不阻塞本变更。
  - Ollama：评测链不依赖本地模型判定，本次不探测。
  - 开关默认值：开启，固定走 `jsonMode`；provider 4xx 或解析失败走文本兜底。
- 原始输出的保留期默认值：**已定为 30 天**（`AI_EVAL_JUDGE_ATTEMPT_RETENTION_DAYS`，`0` 表示不清理）。
