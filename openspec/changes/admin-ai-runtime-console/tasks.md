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
- [x] 3.3 手工：制造 FAILED Outbox / AI 死信，页面可重放
  - FAILED Outbox（真实入队失败）：`CONFIG SET maxmemory 1mb`（noeviction）后经产品接口发消息，`ai_task_outbox` 第 8 次重试落 `FAILED`，`last_error="OOM command not allowed when used memory > 'maxmemory'..."`；`/ai-ops/runtime` 过滤 FAILED → `重新投递`（confirm「确认重放 Outbox 任务 …」）→ 行变 `SENT|attempts=1`，监听器随后处理该消息。演练后已恢复 `maxmemory 400mb`。
  - AI 死信（真实锁超时）：手动占用 `ai:conv:cmwuj3v0j00arru3z4750tbvm`（TTL 1200s）后经 `POST /chat/message` 发消息 `71a4bdd4-…`；BullMQ `attempts:3` 三次均以 `AI conversation lock not acquired within 130106ms` 失败，第 3 次后 `dead=true` 进入 failed 集合，页面死信表出现该行（attemptsMade=3）。释放锁后页面 `重新处理`（confirm「确认重放 AI 死信 …」）→ 行消失，`replay-ai` 写入 `admin_operation_logs`，监听器加锁成功并落库 AI 回复（`triggerMessageId=71a4bdd4-…`）。
  - 已知外部依赖：演练窗口内 `api.deepseek.com` 从宿主与容器均 `ECONNREFUSED`，重放后的回复走了「人工客服暂时不在线」降级文案；队列/锁/重放链路本身验证通过，LLM 内容未参与本次断言。
