# Spec Delta

## Purpose

规定 admin 端用户长期记忆的查看与删除契约，满足运营排查与合规删除，同时限制敏感数据暴露。

## ADDED Requirements

### Requirement: 记忆必须按用户查看

系统 SHALL 按 userId 返回 `AiUserMemory` 与 `AiMemorySummary`；MUST 仅允许 SUPER_ADMIN/ADMIN 访问。

#### Scenario: 查看用户记忆

- **WHEN** 管理员输入 userId
- **THEN** 页面展示 kind/key/value/confidence/status/expiresAt/lastUsedAt

### Requirement: 删除必须可审计

系统 SHALL 支持单条软删与整用户删除；所有删除 MUST 写 `AdminOperationLog`。

#### Scenario: 删除用户全部记忆

- **WHEN** SUPER_ADMIN 确认删除
- **THEN** 记忆与摘要被删除，并记录操作者与数量

### Requirement: 摘要无数据时必须说明

系统 SHALL 在 `AiMemorySummary` 为空时显示“暂无摘要落库”，MUST NOT 暗示摘要已正常工作。

#### Scenario: 摘要为空

- **WHEN** 用户只有偏好/事实
- **THEN** 摘要区显示空态说明

### Requirement: 权限必须 fail-closed

系统 SHALL 在非授权角色访问时返回 403；前端隐藏按钮只是体验，不是权限边界。

#### Scenario: VIEWER 删除

- **WHEN** VIEWER 调用删除接口
- **THEN** 后端返回 403
