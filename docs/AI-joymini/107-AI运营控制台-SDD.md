# 107 · Admin AI 运营控制台 SDD

> 状态：P0 实施中
> 关联：`openspec/changes/admin-ai-runtime-console/`、`openspec/changes/admin-ai-governance-console/`
> 目标：把 AI 客服的生产运营能力收进 admin，形成可观测、可处理、可审计的控制台。

## 1. 背景

admin 现有 AI 入口 6 个：知识库、AI Prompt、Intent Examples、客服工作台、客服渠道、AI Feedback（默认隐藏）。后端已有队列/死信、Outbox、流程版本、长期记忆、Token 用量、注入检测、SLA、评测等能力，但大多只能靠 API、cron、Loki 或查库操作。

## 2. 信息架构

新增一级菜单组 **AI Operations**：

| 路由               | 名称        | 优先级 | 说明                                    |
| ------------------ | ----------- | ------ | --------------------------------------- |
| `/ai-ops`          | Overview    | P0     | 健康度、队列、死信、Outbox、今日 token  |
| `/ai-ops/runtime`  | Runtime     | P0     | 队列、死信、Outbox、重放                |
| `/ai-ops/flows`    | Flows       | P0     | 定义版本、绑定、审计、切换/回滚         |
| `/ai-ops/usage`    | Usage       | P0     | token 用量（受限口径）                  |
| `/ai-ops/memory`   | Memory      | P0     | 用户记忆查看/删除                       |
| `/ai-ops/quality`  | Quality     | P1     | 反馈分诊、评测集、Prompt 测试、RAG 质量 |
| `/ai-ops/security` | Security    | P1     | 注入命中                                |
| `/ai-ops/support`  | Support Ops | P1     | 排队/SLA                                |
| `/ai-ops/insights` | Insights    | P2     | containment/转人工率/重复追问           |

## 3. P0 功能

### 3.1 Overview

- 卡片：AI 队列 waiting/active/failed、AI 死信数、Outbox FAILED、今日 token、RAG 队列
- 快速入口：Runtime / Flows / Usage / Memory
- 数据每 15–60s 轮询
- 不做通用监控，`/monitor` 继续跳 Grafana

### 3.2 Runtime

**队列**

- 字段：name、waiting、active、completed、failed、delayed、paused、total
- 操作：Pause / Resume / Clean（二次确认）
- `rag-embedding` 已纳入监控

**AI 死信**

- 字段：messageId、conversationId、attemptsMade、failedReason、failedAt
- 操作：Replay（后端 `Job.retry()`；已有 AI 回复则拒绝）

**Outbox**

- 字段：messageId、conversationId、status、attempts、lastError、nextAttemptAt
- 状态筛选：PENDING/SENDING/SENT/FAILED
- 操作：FAILED 重放

### 3.3 Flows

- 定义版本列表，按 flowType 分组
- 定义详情：payload
- 会话绑定：输入 conversationId 查询
- 审计：bind/switch/rollback 记录
- 操作：Switch / Rollback definition（二次确认）
- 状态回滚 `rollback-state` 暂不在页面暴露（缺 checkpoint 列表）
- 操作者来自 JWT，body 的 actorId/createdBy 不生效

### 3.4 Usage

- 日期范围（默认 7 天）
- 汇总：total/prompt/completion tokens、requests、users
- 配额：`AI_DAILY_TOKEN_LIMIT`、`AI_SESSION_TOKEN_LIMIT`（只读）
- 用户排行：total tokens、overDailyLimit
- **口径**：仅 AI 客服主链路、成功流、UTC；不含 blog-ai/embedding/eval、失败/取消流

### 3.5 Memory

- 输入 userId 查询
- 展示 kind/key/value/confidence/status/expiresAt/lastUsedAt
- 单条软删（SUPER_ADMIN）
- 整用户删除（SUPER_ADMIN，二次确认，写 OperationLog）
- 摘要表当前无写入方：显示“暂无摘要落库”

## 4. 权限

| 操作                 | VIEWER | ADMIN | SUPER_ADMIN |
| -------------------- | ------ | ----- | ----------- |
| Runtime 查看         | ✅     | ✅    | ✅          |
| 队列/重放写操作      | ❌     | ✅    | ✅          |
| Flows 查看           | ✅     | ✅    | ✅          |
| Flow switch/rollback | ❌     | ✅    | ✅          |
| Usage 查看           | ✅     | ✅    | ✅          |
| Memory 查看          | ❌     | ✅    | ✅          |
| Memory 删除          | ❌     | ❌    | ✅          |

前端隐藏按钮只是体验；后端 `RolesGuard` 是边界。

## 5. API

```text
GET    /admin/queues
PATCH  /admin/queues/pause
PATCH  /admin/queues/resume
DELETE /admin/queues/clean
GET    /admin/queues/ai/failed
POST   /admin/queues/ai/:messageId/replay
GET    /admin/queues/ai/outbox?status&limit
POST   /admin/queues/ai/outbox/:messageId/replay

GET    /admin/ai-flows/definitions?flowType
GET    /admin/ai-flows/definitions/:id
GET    /admin/ai-flows/bindings?conversationId
GET    /admin/ai-flows/audit?conversationId&flowType&limit
POST   /admin/ai-flows/bind
POST   /admin/ai-flows/switch
POST   /admin/ai-flows/rollback-definition

GET    /admin/ai-usage/summary?from&to
GET    /admin/ai-usage/users?from&to&page&pageSize&keyword
GET    /admin/ai-usage/users/:userId?from&to

GET    /admin/ai-memory/users/:userId
DELETE /admin/ai-memory/:id
DELETE /admin/ai-memory/users/:userId
```

## 6. 页面状态

每个页面必须覆盖：正常、空态、加载、错误、边界（长文本/分页/重复点击）、Light/Dark、中/英、角色差异、刷新后筛选保持。

## 7. 非目标

- 不做成本/模型/供应商拆分
- 不做在线修改配额/阈值/注入模式
- 不做 checkpoint 列表与状态回滚 UI
- 不做用户端记忆编辑
- 不替换 Grafana

## 8. 验证

- 后端 `tsc` + 全量测试
- admin-next `tsc` + routes 测试 + build
- 手工：Outbox 重放、AI 死信重放、流程切换拒绝原因、记忆删除
