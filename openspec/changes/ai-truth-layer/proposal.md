# Proposal

## Why

知识库文档与业务配置已经不一致，且没有任何机制能发现。

实测（本地库，2026-11-27）：

- `deposit-guide` 宣称入金支持 PESONet、信用卡（2.5%）、柜台（7-Eleven / MLhuillier / Palawan），而 `payment_channels` 表里只有 GCash、PayMaya、BDO 三个入金渠道。
- `withdrawal-guide` 写 GCash 提现固定 ₱15，配置实际是 0.8% + ₱5（提现 ₱10,000 实收 ₱85）。
- `withdrawal-guide` 写 Bank 提现最低 ₱100，配置最低 ₱200。
- 文档还宣称支持 PayMaya、PESONet 提现，而这两种提现渠道不存在。

用户按文档操作会失败或被多扣费。现有评测判不出这个问题：判官只判「回答是否忠于检索到的文档」（faithfulness）和「是否命中预期文档」（goldenAgreement），两者都相对文档，文档错则满分。

根因是缺一层声明：**没有一处规定「某类事实以哪里为准」**。文档、Prompt、模型都能单方面宣称能力，而没有任何一方被指定为权威。

## What Changes

- 新增**事实权威来源登记**：费率、限额、时效、支持范围四类事实，各自登记唯一来源（表名 + 字段 + 取值方式），数值不复制进文档。
- 新增**一致性校验**：CI 读取文档中的声明，与真值源逐项比对；不一致则构建失败并指出差异。
- 新增**不可静默跳过**语义：真值源不可达时校验必须失败，不得跳过或视为通过。
- 知识文档改为引用式写法：凡出现具体数值，必须引用真值登记，不得直接写死。
- 不改运行时对话行为：本次不新增工具、不改意图路由、不改生成链路（运行期强制走工具留给后续变更）。

## Capabilities

### New Capabilities

- `ai-quality/truth-source`: 定义哪些事实必须有唯一权威来源、如何登记、如何在 CI 中校验文档声明与来源一致，以及来源不可用时的失败语义。

### Modified Capabilities

无。`ai-customer/answer-grounding` 只规定「回答必须有依据」，`ai-quality/loop-contract` 只规定「质量指标可溯源」，两者都不覆盖「事实本身的权威来源」。

## Impact

- **api**：不改代码。复用现有只读接口 `GET admin/payment/channels/list` 与 `GET admin/rag/documents/:id`
- **harness / tools**：新增一致性校验脚本（`tools/eval/` 下），沿用现有脚本风格
- **ci**：新增一个 GitHub Actions job，参照 `eval-regression.yml` 的 workflow 结构
- **db**：可能新增登记表，或先用仓库内配置文件承载登记（由 design 决定）
- **文档**：`deposit-guide`、`withdrawal-guide` 需要改写为引用式；其余文档按同一模板逐步收敛
- **不影响**：评测指标口径、判官链路、部署流程
