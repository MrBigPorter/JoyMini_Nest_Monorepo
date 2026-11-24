# Design

## Context

当前仓库里存在两套互不相通的评测：

- **管理端评测平台**（`apps/api/src/admin/ai-eval/`）：`AiEvalDataset` / `AiEvalCase` / `AiEvalRun` / `AiEvalResult` 已建好，支持 STORED / LIVE 两种模式、token 预算、基线对比（`baselineRunId`）、注解队列与报告页。实际使用量：1 个数据集、3 条用例、6 次 run、18 条结果。
- **端到端验收 harness**（`tools/eval/e2e/`）：用真实产品 HTTP 与真实账号跑 240 条用例，判官走 `/admin/rag/documents/judge`，结果写 `reports/<timestamp>/detail.json`。已跑数十轮，但这些结果从未进入 `AiEvalRun`。

其他现状：

- `ai_traces` 有 `prompt_name` / `prompt_version` 字段，但 1547 条记录中填充数为 0。
- 判官解析失败时记录为 `verdict='unsolved'`（`ai-eval-judge.service.ts`），与「回答错误」混在一起。
- 判官端点限制：单来源 2000 字符、总来源 8000 字符、回答 4000 字符；harness 预算 7800。
- 回答发布前经过 `redactPiiText` 脱敏，而判官收到的 sources 是原文——同一封邮箱在两边形态不同。
- 约束：单实例部署；不引入 ClickHouse / OTel；开发容器存在 bind mount 不重编的已知问题；账号有每日 200k token 配额。

## Goals / Non-Goals

**Goals:**

- 一次评测 = 一条可复现、可比较、可归因的运行记录；JSON 报告退化为导出物。
- 判官输入有唯一、带版本的定义；回答与 sources 脱敏对称。
- 判官失败与回答错误分账，准确率分母干净。
- 指标定义与基线资格写成可执行规则，替代每次口头约定。
- 用新口径重判两个历史运行，给 6.2 一个可复核的结论。

**Non-Goals:**

- 不替换管理端评测平台，也不把 harness 迁进 NestJS。
- 不回填全部历史 JSON 报告（只重判 6.2 相关的两个运行）。
- 不做在线监控大屏、告警、ClickHouse / OTel 摄取。
- 不改变线上 AI 回复链路与生成逻辑。

## Decisions

### D1. 记录层：库是唯一事实来源，JSON 只做导出

**做法**

- `AiEvalRun` 增加：`datasetSnapshot Json?`（含 `hash` 与本次用例快照）、`codeVersion String?`、`gateMode String?`、`judgeSpecVersion String?`、`metricSpecVersion String?`、`isBaseline Boolean @default(false)`。
- `AiEvalResult` 增加：`answerVerdict String?`（`correct | incorrect | judge_error`）、`answerScore Float?`、`grounding String?`、`judgeErrorKind String?`、`judgeInputHash String?`、`judgeSpecVersion String?`。现有 `verdict` / `score` 保留给管理端任务成功率（`solved | partial | unsolved`）；答案准确性与任务成功率是两个维度，分字段保存、报告分栏展示。
- `AiEvalResult.verdict` / `score` 在本次迁移中改为 **nullable**：EXTERNAL run 由 harness 写入，没有任务成功率判定，硬塞 `unsolved` 会把两套口径重新混在一起。读取方（`loadBaseline` 的 `passRate`、run 对比段、类型定义）必须跳过 null，EXTERNAL run 一律改读 `summary.accuracy`。注解队列只在 `executeRun` 内创建，不受影响。
- `AiEvalRun.mode` 是 `String` 而非数据库枚举，新增 `EXTERNAL` 只需放开 DTO 校验与前端联合类型，无需枚举迁移。
- `AiEvalRun.mode` 增加 `EXTERNAL`：结果由外部 harness 分两段写入（创建 RUNNING、收尾写结果）。
- 外部运行首次写入时，按 `datasetFingerprint` 物化一个 `AiEvalDataset`（`name = 'e2e:<fingerprint>'`）及对应 `AiEvalCase`；同一 fingerprint 的后续 run 复用。这样不必改动 `AiEvalRun.datasetId` 与 `AiEvalResult.caseId` 的非空外键，也让 golden 集在管理端可见。
- 快照按 harness 实际字段存 `{caseId, kind, question, expectedDocIds, lang}`；入库前对 `question` 做 PII 脱敏。

**为什么在 run 开始时存整份快照，而不是只存 hash**

评测可能跑几小时，期间数据集被编辑会让「按 hash 复现」落空。240 条 `{caseId, kind, question, expectedDocIds, lang}` 约几十 KB，放进 Json 列可接受；同时用 `sha256(稳定序列化)` 生成 `hash` 供快速比较。

**为什么物化 dataset 而不是改外键**

`AiEvalRun.datasetId` 与 `AiEvalResult.caseId` 都是非空外键，harness 的 240 条用例在库里原本没有对应行。物化 dataset 保持了现有约束，也顺带把 golden 集变成管理端可见的数据集。替代方案（`caseId` 改 nullable + 新增 `externalCaseId`）会放松现有约束并牵动报告与注解代码，收益不足。

**替代方案**

- 只存 hash + dataset 版本表：多一张表，且仍需处理运行中编辑。否决。
- 继续用 JSON 文件 + manifest：无法被管理端查询，也无法与 `baselineRunId` 联动。否决。

### D2. 口径层：JudgeInputSpec 在服务端生成

**做法**

- 新增 `apps/api/src/admin/rag/judge-input-spec.ts`：导出 `JUDGE_INPUT_SPEC_VERSION` 与 `buildJudgeInput({ question, answer, sources?, expectedDocIds?, citedDocIds? })`。
- 该函数负责：挑选 sources（相关度排序 + 2000/8000 上限）、截断回答、**对 answer 与 sources 调用同一个 `redactForJudge()`**。
- `redactForJudge()` 复用现有 `redactPiiText` + `maskEmail`，但只在一处调用，禁止 harness 自行拼接。
- 判官请求 DTO 调整：`sources` 改为可选；新增 `expectedDocIds?`、`citedDocIds?`。传了 `sources` 就按原样使用（兼容判 A 与旧调用方），否则服务端按 docId 取 chunk。
- `KnowledgeDocument.docId` 不是全局唯一（只有 `[docId, locale]` 唯一），因此新增 `RagService.getChunksByDocId(docId, locale = 'en')`，先按 `docId + locale + isActive` 定位文档再取 chunk。
- 选源排序必须固定 tie-break（按原始顺序或索引），否则 `judgeInputHash` 会抖动。
- 判官端点返回 `judgeInputHash`（对最终送审内容做 sha256）与 `specVersion`，写入结果。
- `EVAL_JUDGE_SPEC=v1|v2` 开关，Phase 1 默认 v1，Phase 2 切 v2 并用历史运行做对照。

**为什么放服务端**

harness 与 API 各拼一份 sources 正是这次口径漂移的根因。把「判官看什么」收进被判官端点本身，harness 只传原始字段，离线重判也走同一端点。

**替代方案**

- 在 `tools/eval/e2e/judge.mjs` 复制一份实现：两处必然漂移。否决。
- 把规范做成数据库配置：当前只有一个判官，增加运维面却没有收益。否决。

### D3. 判定层：三态 + 错误类型

**做法**

- 答案准确性由 `apps/api/src/admin/rag/rag-faithfulness.service.ts` 的判官产生 `answerVerdict: correct | incorrect | judge_error`；`judge_error` 必带 `judgeErrorKind`：`auth | rate_limit | timeout | output_format | policy | harness | not_applicable`。
  - `harness`：harness 自己没跑完（断线、崩溃、超时）。这不是判官失败，也不是回答错误。
  - `not_applicable`：该用例判的是任务完成度或安全断言（`action` / `read` / `boundary`），与答案准确性不是一个维度，不参与准确率。
  - Phase 1 两者都写 `judge_error`（结果行数与用例数保持一致），但**必须从 `judgeErrorRate` 的分子里排除**（Phase 2 指标规范落地时一并实现）；`reason` 保留 `harness_error:` / `harness_skipped:` / `not_applicable:` 前缀便于回查。
- 解析失败、重试耗尽、返回结构非法返回 `faithful: null` + `errorKind`，**不再返回 `faithful: false`**。`report.mjs` 的 `isApplicableJudged` 不能只看 `faithful != null`，必须同时排除 `errorKind != null`，否则判官失败仍会被算进分母。
- 管理端任务成功率仍由 `ai-eval-judge.service.ts` 的 `solved / partial / unsolved` 负责，本次不改其语义。
- 准确率分母 = `correct + incorrect`；判官错误率 = `judge_error / 全部判定`，按 run 汇总写入 `summary`。

**为什么**

当前 ±1 条波动被当成事实争论，本质是「判官没答上来」和「回答不对」用了同一个桶。分账后，口径变化与判官抖动都能被单独看见。真正影响 6.2 的 kbAccuracy 走的是 faithfulness 判官，不是任务判官，所以修复点必须在 `rag-faithfulness.service.ts`。

**替代方案**

- 判官失败直接重跑直到成功：配额有限，且会掩盖系统性问题。否决。

### D4. 归因层：trace 与 run 双向可查

**做法**

- Graph 状态新增 `promptBinding: { name: string; version: number | null; source: 'db' | 'code' }`，由 `PromptResolverService` 填充；无 DB override 时 `name` 回退到 `entry.tag`（resolver 此时返回 `promptName: null`），`source='code'`、版本为空。
- 多 agent 场景：主绑定取**第一个成功执行的标准 agent**（按执行顺序），全部绑定另存 `metadata.promptBindings[]`；`reducer` 用后写覆盖，但每个节点返回路径都必须显式写 `promptBinding`（含 null），否则会像 `pendingConfirm` 一样被 checkpoint 跨轮保留。
- `AiCustomerService.recordReplyTrace` 从 `finalState.values.promptBinding` 读取并落 `promptName` / `promptVersion`，metadata 记 `promptSource`。
- harness 在 run 开始时取完整 `git rev-parse HEAD`（或 `GIT_SHA`）写入 `codeVersion`；判官版本取 `judgeModel` + `JUDGE_INPUT_SPEC_VERSION`。
- 报告归因时对比四个维度：codeVersion、promptBinding、datasetSnapshot.hash、judgeSpecVersion。

**为什么**

没有这四个版本，报告只能回答「数字变了」，不能回答「为什么变」。

### D5. 指标规范：单一文件 + 版本常量

**做法**

- 新增 `tools/eval/e2e/METRICS.md`，逐条写明：名称、含义、分母、排除项、数据来源。
- 新增 `tools/eval/e2e/metrics-spec.mjs`，导出 `METRIC_SPEC_VERSION` 与各指标计算函数；`report.mjs` 只调用它，不再内联公式。
- 首批指标：

| 指标 | 定义 | 分母 | 排除项 |
| --- | --- | --- | --- |
| `answeredRate` | 非兜底回复 / 总轮次 | 全部轮次 | 无 |
| `kbAccuracy` | `correct / (correct + incorrect)` | 依据分型为 `kb` 的用例 | `judge_error`、非 `kb` 分型 |
| `ungroundedRisk` | `grounding=none` 且含事实断言的条数 | 知识类用例 | 澄清追问、兜底话术 |
| `hitAt3` | 检索前三命中 golden 文档 | 有 golden 文档的用例 | 无 |
| `judgeErrorRate` | `judge_error / 全部判定` | 全部判定 | 无 |
| `p95Latency` | 轮次时延 95 分位 | 全部轮次 | 无 |

**为什么单独建文件**

指标定义现在散在 `report.mjs` 与几份 findings.md 里。集中后，口径变更必须改版本号，历史结果自动分组。

### D6. 基线规则：写进接口校验

**做法**

- 新增 `POST /admin/ai-eval/runs/:id/promote`：校验 ① 状态为 COMPLETED；② `judgeErrorRate < EVAL_MAX_JUDGE_ERROR_RATE`（默认 0.02）；③ `codeVersion`、`datasetSnapshot.hash`、`judgeSpecVersion`、`metricSpecVersion` 齐全；④ 指标定义版本与当前一致。通过后事务内把其他 run 的 `isBaseline` 置 false，本条置 true。
- **必须补读取方**：`startRun` / `loadBaseline` 在未显式传 `baselineRunId` 时回退到当前 `isBaseline` 的 run；否则 promote 写完后不会成为比较基线，等于死字段。
- 不满足条件的 run 仍可查看，但报告标注「仅诊断」。

**为什么用 `isBaseline` 字段而不是外部配置**

基线是评测领域内的概念，跟着 run 走才能被历史报告查询；外部配置会在多环境间漂移。

### D7. harness 接线：外部结果分段写入

**做法**

- 新增两个接口：
  - `POST /admin/ai-eval/runs/external`：创建 RUNNING run，返回 `runId`；入参含 `datasetSnapshot`、`codeVersion`、`gateMode`、`judgeSpecVersion`、`metricSpecVersion`、`baselineRunId?`。
  - `POST /admin/ai-eval/runs/:id/external-results`：写 `cases[]` 并把 run 置 COMPLETED / FAILED；每条含 `caseId`、`question`、`answerVerdict`、`answerScore`、`reason`（必填）、`grounding`、`judgeErrorKind?`（取值见 D3，含 `harness` / `not_applicable`）、`judgeInputHash?`、`traceId?`、`latencyMs?`。`judge_error` 的 `answerScore` 记 0。
- 首次写入时按 `datasetFingerprint` 物化 dataset 与 cases（见 D1），后续复用；`externalId → caseId` 的映射在服务端按 dataset 解析，不使用不可靠的 upsert。
- `run.mjs` 在 `buildCases` 之后创建 run，在补齐 grounding / 补判之后、`writeReport` 之前提交结果；ingest 失败只记日志并保留 JSON，不让整轮报告丢失。
- `mode='EXTERNAL'` 必须绕开现有 `recoverStaleRuns` 的 30 分钟清扫与「每数据集仅一个 RUNNING」守卫：EXTERNAL 的 stale 阈值放宽到 24 小时，且 `startRun` / `executeRun` 显式拒绝或短路 EXTERNAL，避免被当成 STORED 重跑覆盖结果。
- 前端 `types.ts` 的 mode 联合类型与 `ai-ops/quality` 的展示分支需同步，EXTERNAL 不能显示成「历史回答」。
- 新 DTO 必须先于 harness 上线：全局 `ValidationPipe` 开了 `forbidNonWhitelisted`，旧服务端会把新字段直接 400。
- `detail.json` 仍生成，作为可离线查看的导出物；报告页读库是新增工作，不复用现有的 `EvalReportsController`（它读的是另一套 conversation 报告目录）。

**为什么不让 harness 直接写库**

harness 已有只读 psql 辅助，但写库绕过服务层校验与审计；接口也让管理端未来能触发同一套记录。

### D8. 6.2 测量修正并入 Phase 2

**做法**

- 用 `JUDGE_INPUT_SPEC_VERSION=v2` 重判 `20261124-005755` 与 `20261124-113254` 两个运行的既有回答，不重跑用例、不改回答。
- 两次重判都记录同一 `metricSpecVersion` 与同一 judge spec，产出的 kbAccuracy 才可直接比较。
- 结论写入 `reports/20261124-113254-rejudged-v2/summary.md`，并回写 `ai-answer-grounding/tasks.md` 6.2。

**为什么必须并入**

否则本变更落地后 6.2 仍要按旧口径争论一次，等于白做。

## Risks / Trade-offs

- **run 快照体积** → 只存 `{caseId, kind, question, expectedDocIds, lang}` 并对 question 脱敏；超过 2MB 时降级为 hash + caseId 列表并告警。
- **两套判定混用**（任务成功率 vs 答案准确性）→ 分别存 `verdict` 与 `answerVerdict`，报告分栏展示，禁止合并计算；管理端 EXTERNAL run 的通过率改用 `summary.accuracy`，不能读 `verdict`。
- **`verdict` / `score` 改 nullable 牵连读取方** → 现有基线 `passRate`、对比段与前端类型都假设非空；同批改为跳过 null，并用 controller 单测锁住「EXTERNAL run 的 passRate 来自 `summary.accuracy`」。
- **判官输入改动改变历史数字** → 不覆盖旧结果；v1/v2 结果并存，按 `judgeSpecVersion` 分组。
- **判官失败仍混入分母** → `faithful: null` 同时承担「不适用」，因此统计必须看 `errorKind != null`；报告单测覆盖该条。
- **脱敏对称后判官可能更严** → 先用两个历史运行做对照，若 kbAccuracy 大幅下降，人工抽 10 条核对判官理由，再决定是否调整 spec。
- **trace 版本字段新增耦合** → 写入失败按 null 处理，不影响回复；`promptBinding` 必须出现在所有 orchestrator 返回路径，避免 checkpoint 跨轮残留。
- **外部写入接口被误用** → 仅管理员鉴权；校验 `datasetSnapshot.hash` 与 `cases` 数量一致；写入后不可修改结果，只能重跑。
- **长跑外部 run 被清扫误杀** → EXTERNAL 绕开 30 分钟 stale 清扫与单 RUNNING 守卫，阈值放宽到 24 小时。
- **开发容器 stale build** → 所有真实接口验证前 `docker restart lucky-backend-dev`，写入 README。

## Migration Plan

1. **加字段迁移**：全部为 nullable 或带默认值，无锁表风险。
2. **Phase 1 上线**：harness 双写（JSON + 外部接口），判定逻辑不变；观察一周，确认 run 记录完整。
3. **Phase 2 上线**：默认启用 `JUDGE_INPUT_SPEC_VERSION=v2`，保留 `EVAL_JUDGE_SPEC=v1` 开关回滚；重判两个历史运行并出对比报告。
4. **Phase 3**：启用 promote 接口与报告读库；`summary.md` 改为从库生成。
5. **回滚**：切回 `EVAL_JUDGE_SPEC=v1`；新增字段与 run 记录保留，不影响线上回复。

## Open Questions

- 判官错误率阈值 2% 是否合适：先按默认值执行，积累 3 轮后再校准；阈值通过环境变量可调，不阻塞实现。
- 历史 JSON 报告是否需要全量回填：暂不做；只有 6.2 相关的两个运行在 Phase 2 重判。
