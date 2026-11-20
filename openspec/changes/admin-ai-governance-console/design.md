# Design

## Context

`FlowStateVersioningService` 已有定义、绑定、切换、回滚、审计写入；`AdminOperationLog` 可复用；`AiUsageDaily` 已有日聚合；`AiUserMemory`/`AiMemorySummary` 已有 TTL 与删除方法。缺的是只读/操作 API 与页面。

## Goals / Non-Goals

**Goals:** 流程治理页面、受限 Usage 页面、Memory Inspector。

**Non-Goals:** 不做在线修改配额/阈值；不做用户端记忆编辑 UI；不做成本/模型拆分；不做 checkpoint 列表。

## Decisions

### D1. Flow 页面只做定义与绑定

- 定义列表/详情（payload）
- 按 conversationId 查绑定
- 审计日志查询（新增 `GET /admin/ai-flows/audit`）
- 切换/回滚定义；状态回滚不在页面暴露（缺 checkpoint 列表）

### D2. 操作者只来自凭证

`registerDefinition` / `bind` / `switch` / `rollback-*` 的 actor 从 `@CurrentUserId()` 注入，覆盖 body 中的 `actorId/createdBy`。审计不可伪造。

### D3. Usage 是受限账本

只统计 AI 客服主链路、成功流、UTC 日期。页面必须显示 coverage note；不展示成本、模型、供应商、单会话成本。

### D4. Memory 最小管理面

- 仅 SUPER_ADMIN/ADMIN 可查看
- 仅 SUPER_ADMIN 可删除
- 单条软删（status=DELETED），整用户删除走 `AiMemoryService.deleteUserMemories`
- 所有删除写 `AdminOperationLog`
- `AiMemorySummary` 当前无写入方，页面显示空态，不作为交付阻塞

### D5. 审计与索引

- Flow audit 查询按 conversationId/flowType/limit；时间倒序
- 后续可补 `FlowBindingAuditLog(flowType, createdAt)` 索引
- Memory 删除写 OperationLog

## Risks / Trade-offs

- **[Usage 口径不完整]** 页面明确标注，不作为成本决策唯一依据
- **[Memory 隐私]** 仅管理角色可见，删除审计
- **[Flow 操作影响]** 切换只改绑定指针，不撤销业务副作用；页面二次确认
