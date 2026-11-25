# Tasks

## 1. 契约落点

- [ ] 1.1 新建 `apps/api/src/admin/ai-eval/quality-contract.registry.ts`，以 `as const` 导出 `SUMMARY_KEYS`（按族）、`ENUM_VALUES`（按字段）、`METRIC_FAMILIES`、`STATE_TRANSITIONS` 四组登记；验证：文件存在且 `yarn workspace @lucky/api tsc --noEmit --pretty` 通过 [Req: 链路十步必须各有唯一产出与消费方]
- [ ] 1.2 在注册表增 `TERMS`（基线/对比运行/待处理/当前版本/最新写入版本）与 `AUTHORITY_RULES`，逐条对照 `docs/AI-joymini/122-AI质量闭环-需求总纲.md` §6；验证：术语与总纲逐条一致，无第二种义项 [Req: 术语必须唯一]
- [ ] 1.3 在注册表登记三类状态机的允许转移（反馈 `reviewStatus`、`AiEvalRun.status`、回归状态），确保 `FIXED_PENDING_VERIFY` 有出边；验证：每个登记状态至少一条出边，无孤立状态 [Req: 状态机不得有死状态]
- [ ] 1.4 把 `design.md` 的「Requirement ↔ 实现 ↔ 验证」映射表复制为 `tasks.md` 顶部可见的核对清单，供三个修复 change 引用；验证：七条 Requirement 各有实现位置与验证用例，无空行 [Req: 一致性门禁必须可执行]

## 2. 门禁测试

- [ ] 2.1 新建 `apps/api/src/admin/ai-eval/quality-contract.spec.ts`，调用真实 `buildSummary` 与 `buildExternalSummary`（测试桩），断言其 key 集合 ⊆ `SUMMARY_KEYS`；验证：`yarn workspace @lucky/api test -- quality-contract` 通过，人为加一个未登记 key 时测试失败 [Req: 链路十步必须各有唯一产出与消费方]
- [ ] 2.2 在同一个 spec 中断言 `METRIC_FAMILIES` 的族与版本一一配对，且 `metricFamily` 缺失的 summary 被判失败；验证：删除 `metricFamily` 字段时测试失败 [Req: 指标必须登记族、分母与版本]
- [ ] 2.3 在同一个 spec 中断言 `STATE_TRANSITIONS` 每个状态有出边、`FIXED_PENDING_VERIFY` 可自动推进；验证：删除一条出边时测试失败 [Req: 状态机不得有死状态]
- [ ] 2.4 在同一个 spec 中断言 run 级溯源的必填字段（run id、族/版本、`judgeSpecVersion`、`datasetSnapshot`、`scope`），并验证缺版本时比较入口被禁用；验证：置空 `judgeSpecVersion` 时比较断言失败 [Req: 对外数字必须可溯源]
- [ ] 2.5 在 `docs/coding-standards.md` 增「AI 质量链路改动」审阅项：声明所改链路步骤、四不变量影响、运行 `quality-contract` 测试并核对映射表；验证：grep 可检索到该审阅项，且列在既有 9 维清单之内 [Req: 一致性门禁必须可执行]
- [ ] 2.6 全量验证：`openspec validate "ai-quality-loop-contract" --strict`、`yarn workspace @lucky/api test -- quality-contract`、`yarn workspace @lucky/api tsc --noEmit --pretty` 全部通过；验证：三条命令均以 0 退出 [Req: 一致性门禁必须可执行]

## Workflow follow-up

- 实现并验证通过后运行 `openspec archive "ai-quality-loop-contract"`，把 `ai-quality/loop-contract` 归档为主 spec。
- 归档后确认 `openspec/changes/` 下三个修复 change 均引用归档后的 capability 路径。
