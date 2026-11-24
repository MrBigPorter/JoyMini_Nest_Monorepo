# admin-ai/insights Specification

## Purpose

规定 admin 端 AI 对话运营指标的聚合口径与展示契约。

## Requirements

### Requirement: 指标必须说明口径

系统 SHALL 返回 conversations/messages/transfers/feedback/usage，并附带口径说明。

#### Scenario: 查看指标

- **WHEN** 运营打开 `/ai-ops/insights`
- **THEN** 看到指标与 notes

### Requirement: 转人工率必须可拆分

系统 SHALL 返回转人工总数与按 reason 分布。

#### Scenario: 转人工原因

- **WHEN** 有转人工会话
- **THEN** 页面展示原因分布
