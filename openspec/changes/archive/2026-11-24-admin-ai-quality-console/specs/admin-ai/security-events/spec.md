# Spec Delta

## Purpose

规定注入检测命中的持久化与运营查询契约，不保存用户原文。

## ADDED Requirements

### Requirement: 注入命中必须落库

系统 SHALL 在检测命中时异步写 type/mode/length/userIdHash，MUST NOT 保存原文。

#### Scenario: log 模式命中

- **WHEN** 检测命中且 mode=log
- **THEN** 写一条 AiSecurityEvent，回答路径不变

### Requirement: 命中必须可查询

系统 SHALL 提供按 type/日期分页查询与类型/模式汇总。

#### Scenario: 查看命中

- **WHEN** 运营打开 `/ai-ops/security`
- **THEN** 看到总数、类型分布与列表

### Requirement: 未启用必须明确

系统 SHALL 在 mode=off 时展示“检测未启用”，MUST NOT 用 0 命中暗示安全。

#### Scenario: mode=off

- **WHEN** 页面加载
- **THEN** 显示当前 mode
