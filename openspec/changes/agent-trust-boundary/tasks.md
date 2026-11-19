# Tasks

## 1. 身份闭包注入

- [x] 1.1 身份改为 AsyncLocalStorage 请求上下文（`requireToolUserId`），工厂签名不变；验证：`tsc` 0 error
- [x] 1.2 删除全部工具 schema 中的 `userId` 字段；验证：`grep -rn "userId: z.string()" graph/tools/` 无输出
- [x] 1.3 工具实现内部改用 `ctx.userId`；验证：逐文件确认无对 `args.userId` 的引用，`tsc` 0 error
- [x] 1.4 更新构造点（agent-factory / tool-registry 装配处）传入 `opts.userId`；验证：`tsc` 0 error，且 `runStandardAgent` 到工具构造的调用链无遗漏
- [x] 1.5 补单测：构造带身份参数的模型输出，断言工具仍以 `ctx.userId` 执行；验证：用例通过，且把 `ctx.userId` 改回 `args.userId` 时用例变红
- [x] 1.6 全量单测；验证：`yarn workspace @lucky/api test` 除 2 个已知过期套件外全绿

## 2. 能力标记与确认流程

- [x] 2.1 为 `TaggedTool` 增加 `capability: { kind: 'read' | 'write'; requiresOwnership: boolean }`；验证：`tsc` 0 error
- [x] 2.2 为全部工具声明能力标记；验证：注册表遍历能列出每个工具的能力，无 `undefined`
- [x] 2.3 确认流程改为从能力标记推导，不再读 `CONFIRM_REQUIRED_TOOLS` 字符串集合；验证：删除该集合后 `tsc` 无引用错误，且既有确认用例全绿
- [x] 2.4 补全 `createAddress` / `updateAddress` 的截停；验证：新增两条用例断言"未确认前不调用 service"
- [ ] 2.5 增加启动自检：存在 `kind === 'write'` 但未纳入确认流程的工具时打 `error` 日志；验证：临时把一个工具的能力标为 write 且排除确认，启动后可见 error 日志
- [x] 2.6 归属校验：`requiresOwnership` 的工具在执行前比对目标归属；验证：构造指向他人数据的参数，返回结构化拒绝且写 `tool.denied` 事件

## 3. 注入检测与输出白名单

- [ ] 3.1 新增输入检测模块（覆盖指令 / 索取内部结构 / 越权试探三类模式），在分类前调用；验证：三类各一条用例命中，正常提问不命中
- [ ] 3.2 命中时降级为普通问答并记录 `injection.detected`（含类型，不含原文）；验证：日志中只见类型与长度，`grep` 不到原文
- [ ] 3.3 `ai-stream.handler.ts` 增加帧类型白名单；验证：构造含内部字段的输出，转发函数丢弃该帧并计数
- [ ] 3.4 检测与白名单各加一个开关，默认关闭到验证通过；验证：开关关闭时行为与变更前逐条一致
- [ ] 3.5 补单测覆盖两条路径；验证：用例通过，且注释说明误报处理策略

## 4. Socket 限流与单飞

- [ ] 4.1 Socket 触发 AI 的入口复用 `SseRateLimiterService` 接口；验证：同一主体连发超过阈值后，超出部分被拒绝且无模型调用
- [x] 4.2 增加按 `conversationId` 的单飞（Redis `SET NX EX`），任务结束释放；验证：并发两次触发，只有一次启动任务，第二次收到"上一轮处理中"
- [x] 4.3 单飞异常路径必须释放（任务抛错也释放）；验证：打桩让任务抛错，随后可立即再次触发
- [x] 4.4 补单测覆盖"并发触发"与"异常释放"；验证：两条用例通过

## 5. 消息序号唯一约束

- [x] 5.1 写一条重复检查 SQL，确认现有数据无 `(conversationId, seqId)` 重复；验证：查询返回 0 行
- [x] 5.2 新增 Prisma 迁移加唯一索引；验证：`prisma migrate deploy` 在本地库执行成功
- [x] 5.3 发送路径去掉"先查再插入"的预查，改为冲突后重试取号（最多 3 次）；验证：并发发送用例不出现重号
- [ ] 5.4 补并发用例；验证：两条消息几乎同时发送，序号互不相同且均落库（唯一索引已在 DB 层兜底，API 级用例待补）

## 6. 文档与验收

- [ ] 6.1 更新 `docs/current-task.md` 对应条目状态；验证：状态与实际一致
- [ ] 6.2 更新 `docs/AI-joymini/87-全项目问题总清单.md` 中 P1-6 / P2-4 / P1-22 / P1-3 / P1-11 的状态与证据；验证：每条都带可复跑的命令或用例名
- [ ] 6.3 输出一份安全边界说明：哪些输入被视为不可信、哪些路径已收口、哪些仍开放；验证：文档写入 `docs/system-review/`，与边界文档口径一致

## Workflow follow-up

- 满足评审要求后归档：`openspec archive agent-trust-boundary`
- 归档后确认 `openspec/specs/ai-customer/agent-trust-boundary/spec.md` 已生成
- 归档顺序：本变更可与 `unify-intent-thresholds` 并行，二者 specs delta 不重叠
