# Tasks

## 1. 后端事件契约

- [ ] 1.1 `MessageCreatedEvent` 末尾增加可选 `isAi`，既有 emit 点不传；验证：3 个既有 emit 点编译通过，事件缺省为 false
- [ ] 1.2 `SocketListener` 重建 payload 时带 `isAi`；验证：单测断言 AI 消息 payload `isAi=true`
- [ ] 1.3 `getMessages` 返回 `isAi`（由 `source === 'ai'` 派生）；验证：历史接口单测覆盖 AI/用户两类消息

## 2. AI 回复走统一事件

- [ ] 2.1 `publishAiReply` 注入 `EventEmitter2`，落库后 emit 一次 `MESSAGE_CREATED`；验证：单测断言 emit 且不再直接 `dispatchToConversation`
- [ ] 2.2 事件携带 `memberIds`、`pushMemberIds`（过滤 `isMuted`）；验证：免打扰成员不进 push 列表
- [ ] 2.3 同一事务更新 `lastMsgContent/lastMsgType/lastMsgTime`；验证：AI 回复后会话列表快照更新
- [ ] 2.4 P2002 重放分支不 emit；验证：唯一键冲突单测断言无事件
- [ ] 2.5 转人工告别语 emit 先于 `AI_TRANSFER`；验证：顺序单测或日志断言

## 3. Flutter 展示

- [ ] 3.1 `SocketMessage`/`ChatMessage`/`ChatUiModel` 增加 `isAi`（默认 false）；验证：解析旧 payload 不崩
- [ ] 3.2 `parse_step` 与 mapper 透传 `isAi`；验证：单测覆盖 true/false
- [ ] 3.3 气泡/发送者区域展示 AI 标识；验证：`flutter analyze` + 组件测试

## 4. 验证

- [ ] 4.1 后端全量测试与 `tsc --noEmit`；验证：全绿
- [ ] 4.2 Flutter `dart analyze` 与相关测试；验证：全绿
- [ ] 4.3 真机/本地双端实测：AI 回复实时到达、历史重载标识一致、离线用户收到推送；验证：截图或日志记录
