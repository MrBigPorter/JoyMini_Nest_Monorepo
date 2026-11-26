# Proposal — 评测运行完整性

## Why

`/ai-ops/quality` 的评测运行链路有六类生产级缺陷：双击启动会并发建两条 run 并双倍烧钱；30 分钟固定阈值会把仍在跑的长任务判死（页面轮询自己杀死 run）；判官解析失败被记成「回答错误」污染通过率；单条失败让整单 FAILED，已完成的 49 条无法续跑；内部 run 从不写快照与判官版本，按构造不可能成为基线却被 promote 入口放行；harness 对写操作样本真实下单核验，违反既有契约。

根因是失败语义没有分层、运行没有身份（快照/版本）、基线没有作用域。本 change 按链路 7-9 步收口，并引用 `ai-quality-loop-contract` 的指标族与溯源要求。

## What Changes

- `admin-ai/quality-loop`：
  - MODIFIED `评测失败必须可见`：仅 run 级失败标 FAILED；单条失败逐条分账并继续；连续失败达阈值才整单失败；summary 保留已判分计数。
  - ADDED 6 条：启动互斥且幂等、心跳判活、判官标准版本化并随运行留存、基线按数据集且仅 EXTERNAL 可登记、写操作样本不得真实执行、指标必须声明族并按族分流。
- `ai-customer/quality-loop`：
  - MODIFIED `判官失败必须与回答错误分账`：内部路径同样写分类并输出判官错误率；写明与整单失败的边界。
  - MODIFIED `评测运行必须保存可复现快照`：内部运行也写数据集快照与代码版本。
  - ADDED `内部评测执行失败必须单独记账`：执行失败单独计，不计 unsolved。
- **BREAKING**（行为收紧）：内部 run 不得再登记为基线；写操作样本不再真实执行。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `admin-ai/quality-loop`: 修改 `评测失败必须可见`；新增启动互斥、心跳、判官版本、基线作用域、写操作安全、指标族六条。
- `ai-customer/quality-loop`: 修改 `判官失败必须与回答错误分账` 与 `评测运行必须保存可复现快照`；新增内部执行失败记账。

## Impact

- 影响：`apps/api`（评测服务、判官服务、run 模型与迁移）、`apps/admin-next`（启动按钮与运行卡）、`tools/eval/e2e`（harness 动作样本）、`deploy/.env.example`。
- 数据：`AiEvalRun` 增 `heartbeatAt`、`executionErrorKind`、`judgeSampleCount`、`metricFamily`；新增部分唯一索引；迁移需清理重复 RUNNING。
- 不改变外部 EXTERNAL 指标口径（`answer_accuracy-v3` 保持不变）。
