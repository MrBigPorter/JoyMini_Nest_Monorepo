# Spec Delta

## Purpose

规定消息创建后的统一事件契约：哪些消息必须走事件、事件携带哪些字段、socket 与离线推送如何保持一致，以及客户端如何识别 AI 生成内容。

## ADDED Requirements

### Requirement: AI 消息必须可识别

系统 SHALL 让所有 AI 生成的消息在历史接口与实时载荷中带 `isAi=true`；非 AI 消息 MUST 为 `false` 或缺省。标记 MUST 由持久化的 `source` 字段派生，不得只存在于内存。

#### Scenario: 历史消息

- **WHEN** 客户端拉取包含 AI 回复的历史消息
- **THEN** 每条消息带正确的 `isAi` 标记

#### Scenario: 实时消息

- **WHEN** 客户端通过 Socket 收到 AI 回复
- **THEN** 载荷带 `isAi=true`

### Requirement: AI 消息必须走统一创建事件

系统 SHALL 在 AI 回复成功落库后发布一次 `MESSAGE_CREATED` 事件；房间广播、私有房间投递与离线推送 MUST 与其他消息走同一套消费者，不得由发布方直接旁路派发。

#### Scenario: 离线用户收到推送

- **WHEN** AI 回复创建时用户不在线
- **THEN** 该用户收到与普通消息一致的离线推送

#### Scenario: 免打扰

- **WHEN** 会话成员开启免打扰
- **THEN** 该成员仍可在 Socket 收到消息，但不收到离线推送

### Requirement: 重放不得重复广播

系统 SHALL 保证每条成功创建的 AI 消息最多发布一次创建事件；因崩溃重放命中唯一键时 MUST NOT 再次发布事件。

#### Scenario: 崩溃重放

- **WHEN** 同一触发消息的重放命中已有 AI 回复
- **THEN** 不创建第二条消息，也不再广播

### Requirement: 会话列表快照必须同步

系统 SHALL 在 AI 回复落库的同一事务内更新会话的最近消息内容、类型与时间，使会话列表预览与排序反映 AI 回复。

#### Scenario: 会话列表

- **WHEN** AI 回复创建后用户回到会话列表
- **THEN** 列表预览与排序使用 AI 回复作为最近消息

### Requirement: 客户端必须展示 AI 标识

客户端 SHALL 在消息模型中保留 `isAi`，并在气泡或发送者区域展示 AI 标识；历史回放与实时消息 MUST 表现一致。

#### Scenario: 实时与历史一致

- **WHEN** 同一条 AI 回复先实时到达、后从历史接口重新加载
- **THEN** 两次都展示 AI 标识
