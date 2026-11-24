# Proposal

## Why

AI 队列、死信、Outbox 已经有 admin API，但运营前端没有入口。生产出现「用户没收到 AI 回复」时，只能靠 curl/SSH 查 Redis 和数据库；`rag-embedding` 队列也不在监控范围内。

## What Changes

- 新增 `/ai-ops` 与 `/ai-ops/runtime` 页面
- 队列状态、pause/resume/clean 可视化
- AI 死信列表与单条重放
- Outbox 列表（按状态）与 FAILED 重放
- `rag-embedding` 纳入 QueueMonitor
- all write actions require confirmation and audit

## Capabilities

### New Capabilities

- `admin-ai/runtime-console`: AI 运行时队列、死信与 Outbox 的运营可视化契约。

### Modified Capabilities

（无）

## Impact

- 后端：`queue-monitor.service.ts`、`queue-monitor.controller.ts`、`queue-monitor.module.ts`、`ai-task-outbox.service.ts`
- 前端：`routes/index.ts`、`app/(dashboard)/ai-ops/**`、`api/index.ts`、`type/types.ts`、i18n
- 不改变队列消费语义与幂等键
