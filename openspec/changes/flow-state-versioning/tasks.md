# Tasks

## 阶段 A：接通 flowState

- [x] A1 `agent-runner` 接收并传递 `flowDataAccumulator`；验证：工具调用的 flowData/flowStatus 能进入结果
- [x] A2 `agent-factory` 不再强制 `flowContext:false`；验证：prompt 中出现 Current Flow Context
- [x] A3 orchestrator 每个返回路径写完整 `flowState`；验证：第二轮 `getState` 能读到第一轮 flowType/step/data
- [x] A4 单测：两轮对话状态延续；验证：用例通过，且 A3 回退时变红
- [x] A5 全量测试与 `tsc`；验证：全绿

## 阶段 B：版本与绑定

- [x] B1 新增 `FlowDefinitionVersion` 表与迁移；验证：`prisma migrate deploy` 成功
- [x] B2 实现定义快照与 `definitionHash`（含 allowedStatuses、step 图、确认映射、prompt 版本、工具 capability）；验证：同内容哈希稳定，变化生成新版本
- [x] B3 新增 `ConversationFlowBinding` 表与绑定服务；验证：新会话绑最新、旧会话保持
- [x] B4 新增 `FlowBindingAuditLog`；验证：bind/switch/rollback 都有记录
- [ ] B5 安全切换守卫：pendingConfirm、Redis pending、进行中流、handlerId、thread 漂移；验证：每类拒绝都有单测（已覆盖 pending/handler/thread/Redis；进行中流待 checkpoint 接入）
- [x] B6 定义回滚（只切绑定指针）；验证：切换后下一轮使用目标版本
- [ ] B7 状态回滚（checkpoint 恢复）设计实现；验证：只在安全点可用，且不撤销业务副作用（当前 API fail-closed）
- [ ] B8 迁移/回滚演练；验证：新旧版本会话共存、回滚审计可查

## 验证

- [x] V1 全量测试与 `tsc --noEmit`；验证：全绿
- [x] V2 本地两轮流程实测；验证：flowType/step/data 跨轮保持
- [ ] V3 版本切换/回滚演练；验证：拒绝条件与审计符合规格
