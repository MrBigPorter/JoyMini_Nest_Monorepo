# Tasks

## 1. 后端动作目录与自检

- [x] 1.1 在 `apps/api/src/client/ai-customer/graph` 内建立唯一 `ACTION_CATALOG`（action、toolName、title、fields、needsOtp、ttl），覆盖 7 个写工具；单测断言目录条目数等于 `registry.getWriteToolNames().length`
- [x] 1.2 让 `mapToolToAction` 与 `buildConfirmSummary` 从目录派生，删除手写 switch；单测断言每个目录项都能生成非空 `fields`
- [x] 1.3 `confirmAction` 的服务端分支按目录执行，未知 action 返回 400 并置失败；单测覆盖全部 7 个 action 与未知 action
- [x] 1.4 重写 `ToolRegistry.auditCapabilities`：校验“写工具 ⊆ 目录”“目录 action ⊆ 确认分支”，未声明能力的副作用工具阻断启动；单测故意漏登记一个动作，断言自检抛错
- [x] 1.5 补齐 `createAddress` / `updateAddress` 的摘要字段（收件人、电话、省市区、详细地址、默认标记）与确认执行参数；单测断言两者可生成卡片且执行参数完整

## 2. 后端确认协议补全

- [x] 2.1 `AI_CONFIRM` 载荷增加 `title`、`fields`、`needsOtp`，保留 `action/summary/confirmToken/expiresAt/requestId`；单测断言已确认卡片与历史客户端所需字段同时存在
- [x] 2.2 新增 `POST /ai/customer/confirm/cancel { token }`：带 owner 校验消费令牌，动作记录置 `CANCELLED`；单测覆盖正常取消、重复取消、跨用户取消
- [x] 2.3 `ai_action_requests` 增加 `CANCELLED` 状态并更新状态机文档；单测断言取消后不可再执行
- [x] 2.4 动作执行完成或失败后发送 `AI_ACTION_RESULT`（action、success、message）；单测断言成功与失败各发送一次且载荷可被 Flutter 模型解析
- [x] 2.5 确认端点补 e2e：领券成功、令牌过期、令牌重放、未知 action 四类；全部使用固定 OTP 或本地环境，不依赖真实短信
  - 完成（2026-11-24）：`apps/api/test/ai-customer/confirm.e2e-spec.ts` 用 supertest 打真实 controller + 真实 `confirmAction`，四类全绿；Redis 为内存假实现，不依赖真实短信/外部服务

## 3. 提现 OTP 强制化

- [x] 3.1 拆分 `ClientWalletService.applyWithdrawVerified`（唯一执行点）与公开入口；单测断言公开入口在未验码时不调用执行点
- [x] 3.2 `POST /wallet/withdraw/apply` 增加必填 `otpCode`，服务端验码后执行；单测覆盖正确码、错误码、过期码、重放码
- [x] 3.3 `confirmWithdrawOtp` 改为调用 `applyWithdrawVerified`，不重复验码；单测断言之执行一次
- [x] 3.4 增加 `WITHDRAW_OTP_ENFORCE` 开关：关闭时记录“未携带 OTP”指标并放行，开启时强制拒绝；单测覆盖两态，文档记录灰度顺序
- [x] 3.5 提现校验补充“禁止卡号/CVV/密码”字段级断言：DTO 拒绝额外字段；单测覆盖夹带卡号请求返回 400

## 4. Flutter 事件与状态

- [x] 4.1 `socket_service._handleDispatch` 增加 `ai_confirm` / `ai_action_result` 分支；单测或 widget 测试断言两类事件进入 AI 处理器
- [x] 4.2 `chat_view_model.copyWith` 增加 `clearConfirm` 标志，成功/取消可清空卡片；单测断言 `confirmData` 被置空
- [x] 4.3 卡片按 `expiresAt` 启动计时器，到点置 `expired` 并禁用按钮；widget 测试用短过期时间断言状态变化
- [x] 4.4 解析 `ai_action_result` 并更新卡片与会话消息；widget 测试覆盖成功与失败两种结果
- [x] 4.5 卡片改为渲染服务端 `title + fields`，未知 action 也能正确展示；widget 测试用一个目录外字段组合断言渲染不崩

## 5. Flutter 确认与 OTP

- [x] 5.1 确认按钮改为调用 `POST /ai/customer/confirm { token }`，删除 `lucky_api.confirmAction` 直调业务接口的 switch；单测断言不再调用业务接口
- [x] 5.2 处理 `{ needOtp: true }`：展示 6 位验证码输入，提交 `POST /ai/customer/confirm/otp`；widget 测试覆盖验证码错误保留输入、成功关闭卡片
- [x] 5.3 取消按钮调用 `POST /ai/customer/confirm/cancel`，失败也关闭本地卡片；widget 测试覆盖成功与请求失败
- [x] 5.4 确认成功后卡片关闭并在会话中显示结果消息；widget 测试断言卡片消失、结果消息出现

## 6. 可观测

- [x] 6.1 工具调用写入 `ai_spans`（`type=tool`，工具名、状态、耗时、脱敏参数摘要）；单测断言成功与失败各产生一条 span
- [x] 6.2 新增 `ai_action_total{action,result}` 计数器，在创建、确认、执行、失败、过期处埋点；单测断言计数增量
- [x] 6.3 会话诊断展示动作的 `CANCELLED` 状态与失败原因；后端单测断言快照包含该字段

## 7. Prompt 口径

- [x] 7.1 `wallet-prompt` 恢复聊天提现：允许收集渠道收款账号、确认后走 OTP，禁止收集卡号/CVV/密码；用固定问题回放断言生成的是提现确认卡片而不是“App 操作”
- [x] 7.2 删除 wallet prompt 中“唯一可写 Agent / 唯一需要 OTP”等与代码不符的表述；单测或静态断言检查关键字不存在
- [x] 7.3 检查其余 6 个 Agent 的写动作指引与目录一致（领券、兑换、抽奖、地址增改删）；用各领域一条回放断言生成对应卡片

## 8. 文档与回归

- [x] 8.1 在 `docs/AI-joymini/83` 标注 §9.8 已被本变更取代，并在 `84` 关闭 P1-1/P1-2；人工核对链接与结论
- [x] 8.2 跑后端全量测试与 `tsc --noEmit`；要求 0 error、无新增失败
- [x] 8.3 跑 Flutter `dart analyze` 与新增 widget 测试；要求 0 error
- [ ] 8.4 手工回归矩阵：7 个动作 × {成功, 过期, 重放, 越权}，提现额外覆盖 {OTP 错误, OTP 过期, 未携带 OTP}；记录结果到 `handoff/` 下的回归清单
  - 状态：待本地起 API + 模拟器执行（需要真实会话与固定 OTP）

## Workflow follow-up

- 所有任务完成后归档本变更，并同步主 spec。
- 灰度 `WITHDRAW_OTP_ENFORCE` 观察一周后再转为默认强制。
