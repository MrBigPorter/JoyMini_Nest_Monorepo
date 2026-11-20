# Tasks

## 1. 后端

- [x] 1.1 `QueueMonitorService` / `QueueMonitorModule` 纳入 `rag-embedding`
- [x] 1.2 新增 `GET /admin/queues/ai/outbox?status=&limit=`
- [x] 1.3 Outbox 列表返回 status/attempts/lastError/nextAttemptAt/sentAt
- [x] 1.4 pause/resume/clean 补 DTO 与操作日志
- [x] 1.5 现有 replay/pause/resume/clean 保持 RolesGuard

## 2. 前端

- [x] 2.1 新增 AI Operations 菜单组与 `/ai-ops`、`/ai-ops/runtime`
- [x] 2.2 队列表 + pause/resume/clean（二次确认）
- [x] 2.3 AI 死信表 + replay
- [x] 2.4 Outbox 表 + 状态筛选 + FAILED replay
- [x] 2.5 空态/加载/错误提示

## 3. 验证

- [x] 3.1 后端 tsc + 全量测试
- [x] 3.2 admin-next tsc + routes 测试
- [ ] 3.3 手工：制造 FAILED Outbox / AI 死信，页面可重放
