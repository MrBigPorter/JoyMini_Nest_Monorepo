# admin-ai/context-debug Specification

## Purpose

规定 admin 端单会话上下文调试的只读契约，用于排查 flowState/contextState 与消息不一致。

## Requirements

### Requirement: 上下文调试必须只读

系统 SHALL 通过 checkpoint 读取单会话 flowState/contextState/pendingConfirm/最近消息；MUST NOT 写入消息或触发模型。

#### Scenario: 查看上下文

- **WHEN** 管理员输入 conversationId
- **THEN** 页面只展示 checkpoint 状态，不产生新消息

### Requirement: 敏感信息必须裁剪

系统 SHALL 只返回最近 20 条消息且单条截断 300 字；MUST NOT 返回完整历史。

#### Scenario: 长会话

- **WHEN** 会话有 100 条消息
- **THEN** 只返回最后 20 条预览
