# Spec Delta

## Purpose

规定 admin 端流程定义版本、会话绑定、审计与安全切换的可视化契约，确保运营不靠 curl 也能治理 AI 流程版本。

## ADDED Requirements

### Requirement: 流程定义必须可查看

系统 SHALL 展示 flowType、version、definitionHash、status、createdBy、createdAt，并允许查看 payload。

#### Scenario: 查看定义

- **WHEN** 运营打开 `/ai-ops/flows`
- **THEN** 能看到定义版本列表与详情

### Requirement: 会话绑定必须可查询

系统 SHALL 支持按 conversationId 查询绑定，展示 flowType、version、flowStep、threadId、status。

#### Scenario: 查询绑定

- **WHEN** 输入 conversationId
- **THEN** 页面展示该会话的流程绑定

### Requirement: 审计必须可查询

系统 SHALL 提供 bind/switch/rollback 审计查询，返回 action、from/to version、actor、reason、createdAt。

#### Scenario: 查看审计

- **WHEN** 运营按 conversationId 查询
- **THEN** 页面展示时间倒序的审计记录

### Requirement: 操作者必须来自凭证

系统 SHALL 从 JWT 注入操作者；MUST NOT 信任 body 中的 actorId/createdBy。

#### Scenario: 伪造 actor

- **WHEN** 请求 body 携带其他 actorId
- **THEN** 审计记录仍使用当前管理员身份

### Requirement: 安全切换必须展示拒绝原因

系统 SHALL 返回并展示 `human_handling`、`thread_drift`、`flow_in_progress`、`pending_confirmation` 等拒绝原因。

#### Scenario: 人工接管中切换

- **WHEN** 会话由人工处理时尝试切换
- **THEN** 页面显示拒绝原因，不修改绑定
