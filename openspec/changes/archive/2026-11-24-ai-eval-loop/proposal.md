# Proposal

## Why

评测结果现在只以每次运行的 JSON 文件存在：同一批用例在不同轮次之间无法自动回答「跟哪一轮比、口径变没变、判官有没有失败」。`ai-answer-grounding` 6.2 因此卡在 84.3% 对 85.5%——差异主要来自 golden 文档集不全和「回答脱敏、sources 未脱敏」的不对称，但系统里没有记录能证明这一点，只能靠人翻判官理由。不先把评测做成闭环，之后每一轮验收都会重复同样的争论。

## What Changes

- **评测运行落库**：一次评测写入 `AiEvalRun` / `AiEvalResult`，绑定数据集快照 hash、代码版本、门禁模式、判官配置版本与运行时间；JSON 报告降级为导出物，库成为唯一事实来源。
- **判官输入规范（JudgeInputSpec）**：显式定义判官能看到哪些字段，以及脱敏规则；回答与 sources MUST 使用同一个脱敏函数；spec 版本与输入 hash 写入每条评测结果。
- **判官三态**：判官对「答案是否正确」的结论分为 `correct` / `incorrect` / `judge_error`，与管理端现有的任务成功率（`solved` / `partial` / `unsolved`）分字段保存，不混用。`judge_error` 不进入准确率分母，单独统计错误率与错误类型（鉴权 / 限流 / 超时 / 格式错误 / 内容策略）。
- **归因字段**：trace 写入 `promptName` / `promptVersion`（字段已存在，当前 1547 条均为空）；每次 run 记录代码版本与判官版本。
- **指标规范与基线登记规则**：每个指标写明定义、分母、排除项；判官错误率超过阈值、缺少版本标识或数据集快照变化时，结果 MUST NOT 登记为新基线。
- **并入 6.2 测量修正**：用新口径离线重判 `20261124-005755` 与 `20261124-113254` 两个历史运行，再决定 `ai-answer-grounding` 6.2 是否收口。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ai-customer/quality-loop`：新增评测运行的可复现记录、判官输入与错误口径、指标定义与基线登记条件；与现有「基线必须可追溯且不可覆盖」「方案比较必须使用配对检验」衔接。

## Impact

- `tools/eval/e2e/`：`run.mjs`、`judge.mjs`、`rejudge.mjs`、`report.mjs` 增加落库与输入规范；报告改为从库生成/导出。
- `apps/api/src/admin/ai-eval/`：run 记录增加版本字段；`AiEvalResult.verdict` / `score` 改为 nullable，EXTERNAL run 只写答案判定；`apps/api/src/admin/rag/rag-faithfulness.service.ts` 的解析失败不再记为「不忠实」，改为 `judge_error`（管理端任务判官 `ai-eval-judge.service.ts` 语义不变）。
- `apps/api/prisma/schema.prisma`：`AiEvalRun` / `AiEvalResult` 增加少量字段；`AiTrace.promptName` / `promptVersion` 仅补写入，不改表结构。
- 管理端 `ai-ops` 页面：只读展示 run 版本信息与判官错误率。
- 不改线上回复链路；Phase 1 不改变任何判定结果。
