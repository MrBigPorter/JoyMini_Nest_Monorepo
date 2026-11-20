# Tasks

## 1. Flow

- [x] 1.1 definition detail API
- [x] 1.2 flow audit list API
- [x] 1.3 写操作 actor 从 JWT 注入
- [x] 1.4 `/ai-ops/flows` 页面：定义、绑定、审计、切换/回滚
- [x] 1.5 switch/rollback 写 AdminOperationLog

## 2. Usage

- [x] 2.1 `GET /admin/ai-usage/summary`
- [x] 2.2 `GET /admin/ai-usage/users`
- [x] 2.3 `GET /admin/ai-usage/users/:userId`
- [x] 2.4 `/ai-ops/usage` 页面与 coverage note
- [ ] 2.5 用户详情页
- [ ] 2.6 配额在线修改（非目标，后续）

## 3. Memory

- [x] 3.1 `GET /admin/ai-memory/users/:userId`
- [x] 3.2 `DELETE /admin/ai-memory/:id`（软删）
- [x] 3.3 `DELETE /admin/ai-memory/users/:userId`（硬删）
- [x] 3.4 删除写 AdminOperationLog
- [x] 3.5 `/ai-ops/memory` 页面
- [x] 3.6 摘要无写入方时显示空态

## 4. 验证

- [x] 4.1 后端 tsc + 单测
- [x] 4.2 admin-next tsc + routes 测试
- [ ] 4.3 手工：切换流程显示拒绝原因；删除记忆后新会话不再注入
