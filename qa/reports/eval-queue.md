# QA Report — Eval Queue + Cancellation

> 冻结提交 `3d4d3387`（eval 队列 `8052f29`）
> 结论：**PASS**（`eval-queue` 5/5；Batch 4 9/9；无迁移改动）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 仓库 | `/Volumes/MySSD/work/JoyMini_Nest_Monorepo` |
| 分支 | `feat/ai-ops-operator-console` |
| 冻结提交 | `3d4d3387`（eval 队列 `8052f29`、EDITOR 全隐藏 `c7322b3c`） |
| 范围 | run 入 BullMQ `ai-eval`；worker 执行到 COMPLETED；取消语义；jobId 去重；API 重启后消费；`AI_EVAL_ENABLED=false` 下 startRun 403 / cancel 可用 |
| 产品代码改动 | 无（QA 只改 `qa/**` 与测试文件） |
| 迁移审核 | `git diff d7bdced2..3d4d3387 -- apps/api/prisma/migrations` 为空；无破坏性语句 |

## 2. 环境与命令

真实 QA API（4102）+ Postgres `joy_mini_qa`（5433）+ Redis DB15（6382）+ judge stub（4199）。测试会真实停/起 API，验证队列作业跨进程存活。

```bash
docker start lucky-db-qa lucky-redis-qa
node qa/scripts/judge-stub.mjs          # 4199；含 qa_eval_slow 4s 延迟钩子
bash qa/scripts/restart-api-env.sh      # 正常 QA API

cd apps/api
../../node_modules/.bin/jest --config ./test/jest-e2e.json --runInBand --forceExit \
  test/ai-ops/eval-queue.e2e-spec.ts
```

日志：`qa/logs/eval-queue-api.log`

## 3. 结果

| # | 用例 | 结果 |
|---|---|---|
| 1 | `startRun` 入队，worker 执行到 COMPLETED | **PASS** |
| 2 | 中途取消：CANCELLED / finishedAt / summary.cancelled / 不再写结果 / 不被覆盖 / 幂等 | **PASS** |
| 3 | 同一 runId 重复入队只保留一个 job（jobId） | **PASS** |
| 4 | 重启 API 后等待中的 job 被新进程消费 | **PASS** |
| 5 | `AI_EVAL_ENABLED=false`：startRun 403，cancel 仍 200 | **PASS** |
| | 合计 | **5 passed / 5** |

### 3.1 关键观测

1. **作业化执行**：`POST /v1/admin/ai-eval/datasets/:id/runs` 返回的 run 处于 RUNNING；队列中存在 `jobId = run.id` 的 `run-eval` 作业；轮询 run 直到 COMPLETED，2 条用例均落 `AiEvalResult`（verdict=solved），`finishedAt` 有值。
2. **取消窗口**：构造 5 条 STORED 用例，第 1 条即时判分，第 2–5 条问题含 `qa_eval_slow`，judge stub 延迟 4s。等第 1 条结果落库后立即 cancel：
   - 响应 200，`status=CANCELLED`、`finishedAt` 有值、`summary.cancelled=true`；
   - 6s 后（延迟判分已返回）仍为 CANCELLED，`AiEvalResult` 数量与取消时一致（1 条），未被 COMPLETED/FAILED 覆盖；
   - 第二次 cancel 仍 200/CANCELLED，结果数不变。
3. **jobId 去重**：暂停队列后启动 run，`queue.getWaiting()` 中该 run 恰 1 个；用同一 `jobId=run.id` 再 add 两次，等待列表中仍只有 1 个 job，`queue.getJob(runId).id === runId`。
4. **重启存活**：暂停队列 → 启动 run（job 在 Redis waiting）→ `qa/scripts/restart-api-env.sh` 停/起 API → resume 队列 → 新进程将 run 执行到 COMPLETED，2 条结果齐全。
5. **开关边界**：暂停队列并启动一个 RUNNING run 后，以 `AI_EVAL_ENABLED=false` 重启 API；同一数据集再次 startRun 返回 **403**（`AI eval is disabled`），而对已存在 run 的 `POST /runs/:id/cancel` 仍返回 **200/CANCELLED**（取消不依赖开关）。

### 3.2 Batch 4 回归

命令与日志：`qa/logs/regression-batch4.log`

```text
Tests: 9 passed, 9 total
```

覆盖原有的空期望拒绝、并发 run 拒绝、stale RUNNING 恢复、用例编辑/删除、STORED/LIVE traceId、judge 失败落 FAILED；新队列路径下全部通过。

## 4. 缺陷

**无。** 本组验收未发现产品缺陷。

## 5. 残留 / 未覆盖

1. **取消只验证 STORED**：LIVE 模式同样走 `ensureRunning`，但本轮未用 LIVE 造长任务；LIVE 的取消窗口未端到端覆盖。
2. **重启用例是 waiting job**：通过暂停队列模拟“进程重启时作业尚未开始”，未覆盖 active job 被 kill 后的 stalled 重投递（BullMQ `stalledInterval`）路径。
3. **jobId 去重为单队列单 worker**：未验证多实例同时投递同一 run 的竞态；`jobId` 由 BullMQ 保证。
4. **未覆盖队列不可用**：`startRun` 的 enqueue 失败会把 run 落 FAILED（代码路径），本轮未停 Redis 验证。
5. **预算/用量**：提交说明明确本任务不含 token/成本记账，未验证。
6. 测试侧在 judge stub 中新增 `qa_eval_slow` 4s 延迟钩子，仅 QA 使用，不影响产品。
