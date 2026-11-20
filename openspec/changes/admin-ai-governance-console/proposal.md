# Proposal

## Why

流程定义/绑定/切换已有 admin API，但运营没有页面；Token 用量与用户长期记忆完全没有 admin 入口。生产上无法安全切换流程、无法定位成本、无法按用户处理记忆删除。

## What Changes

- 新增 `/ai-ops/flows`：定义列表/详情、会话绑定、审计、定义切换/回滚
- 新增 `/ai-ops/usage`：AI 客服主链路 token 用量（UTC）与用户排行
- 新增 `/ai-ops/memory`：按用户查看/删除记忆
- 流程写操作的操作者只来自 JWT，不能由 body 传入
- 补 Flow audit 查询 API 与 definition detail API
- 补 AI usage admin API 与 AI memory admin API

## Capabilities

### New Capabilities

- `admin-ai/flow-governance`
- `admin-ai/usage`
- `admin-ai/memory-admin`

### Modified Capabilities

（无）

## Impact

- 后端：`flow-versioning.controller.ts`、`flow-state-versioning.service.ts`、新增 `admin/ai-usage/*`、`admin/ai-memory/*`
- 前端：`/ai-ops/flows`、`/ai-ops/usage`、`/ai-ops/memory`
- 数据：复用 `AiUsageDaily`、`AiUserMemory`、`AiMemorySummary`、`FlowBindingAuditLog`
- 不改运行时流程语义；usage 只读；memory 删除写审计
