# Design — ai-quality-loop-contract

## Context

见 `proposal.md` 的 Why 与 `specs/ai-quality/loop-contract/spec.md` 的 7 条 Requirement。本 change 只建立契约与门禁的**结构与落点**，不实现功能；三个修复 change 负责具体行为。

现状约束（实测）：

- 既有契约 `admin-ai/quality-loop` 仅 4 条，`ai-customer/quality-loop` 18 条，两套词汇并存。
- 仓库没有任何机制拦截「代码新增字段/枚举但契约未登记」。
- `openspec validate --strict` 可拦超长描述与缺 WHEN/THEN，但不做代码↔契约一致性检查。

## Goals / Non-Goals

**Goals**

- 用一个注册表文件承载「字段/枚举/指标族/状态转移」的登记，让未登记即测试红。
- 给每条 Requirement 固定「实现位置 + 验证用例」两列，映射表写在 `design.md` 并由 `tasks.md` 引用。
- 在 `docs/coding-standards.md` 增加一条可勾选审阅项，把一致性检查放进日常流程。

**Non-Goals**

- 不引入 CI 之外的新工具链；不写运行时校验中间件。
- 不做跨仓校验（Flutter 不在本契约范围）。
- 不在本 change 修复任何页面或接口行为。

## Decisions

### D1 注册表用单一 TypeScript 常量文件，不用 JSON/YAML

`apps/api/src/admin/ai-eval/quality-contract.registry.ts` 以 `as const` 导出四组登记：`SUMMARY_KEYS`（按族）、`ENUM_VALUES`（按字段）、`METRIC_FAMILIES`（族→版本）、`STATE_TRANSITIONS`（状态机→允许转移）。理由：与摘要构造代码同仓同语言，重构可被 tsc 发现；JSON 无法表达状态转移类型的约束。备选（YAML + 解析器）多一层解析与类型丢失，放弃。

### D2 校验用 jest 的「集合包含」断言，不做 AST 扫描

`quality-contract.spec.ts` 直接 import 真实的 `buildSummary`/`buildExternalSummary` 测试桩，断言其 key 集合 ⊆ 注册表；枚举断言覆盖每个产出路径；指标族断言 `metricFamily` 与版本配对。理由：AST 扫描脆弱且需要额外依赖；运行时 key 集合是最终事实。备选（eslint 自定义规则）对动态 key 无效，放弃。

### D3 映射表放 `design.md`，不塞进 delta spec

delta spec 保持纯行为；「实现位置 / 验证用例」属于 HOW，写在本文的映射表，由 `tasks.md` 逐条引用。理由：符合 OpenSpec「spec 描述行为、design 描述做法」的分层；避免 spec 随文件重命名而失效。

### D4 coding-standards 只加一条，不新开文档

在 `docs/coding-standards.md` 增「AI 质量链路改动」审阅项：声明所改链路步骤、四不变量影响、跑 `quality-contract` 测试与映射表核对。理由：审阅项越少越会被执行；新开文档会与既有 9 维清单竞争注意力。

### D5 契约不引入运行时开销

注册表只在测试与开发期被 import；生产代码不读取注册表做运行时校验。理由：契约是开发期约束，运行时校验会把配置错误变成线上故障。

## Requirement ↔ 实现 ↔ 验证映射

| Requirement | 实现位置 | 验证用例 |
|---|---|---|
| 链路十步必须各有唯一产出与消费方 | `quality-contract.registry.ts` 的 `SUMMARY_KEYS`/`ENUM_VALUES` 登记 | `quality-contract.spec.ts`：summary key ⊆ 注册表；枚举无未登记值 |
| 指标必须登记族、分母与版本 | 注册表 `METRIC_FAMILIES`（`verdict3-1`、`answer_accuracy-v3`、`calibration-1`、`knowledge-parse-1`） | `quality-contract.spec.ts`：族与版本一一配对；缺失 `metricFamily` 的 summary 断言失败 |
| 术语必须唯一 | `docs/AI-joymini/122-AI质量闭环-需求总纲.md` §6 术语表；前端共享常量 | 前端 vitest：页面文案使用术语表常量；关键词 grep（基线/待处理/当前版本）无第二义 |
| 权威层级必须成文并被遵守 | 总纲 §6；注册表 `AUTHORITY_RULES` 注释块 | 契约测试：通过率计算不读取标注/`AiScore`/`failureKind`（桩断言调用参数） |
| 对外数字必须可溯源 | run 与 summary 字段登记；`run-evidence.util.ts` 既有检查 | 契约测试：summary 必含族/版本/scope/run 关联字段；缺版本时比较入口返回禁用 |
| 状态机不得有死状态 | 注册表 `STATE_TRANSITIONS` | 契约测试：每个登记状态至少一条出边；`FIXED_PENDING_VERIFY` 出边存在 |
| 一致性门禁必须可执行 | 注册表 + `quality-contract.spec.ts` + `docs/coding-standards.md` 审阅项 | `yarn workspace @lucky/api test -- quality-contract`；审阅项 grep 可检索；映射表无空行 |

## Risks / Trade-offs

- [注册表与真实 summary 漂移] → 测试直接调用真实构造函数而非手写 key 列表，漂移即红。
- [映射表随重构过期] → 映射表只写模块级位置（文件），不写行号；重命名在 tsc 与审阅项中被发现。
- [门禁被绕过（本地不跑）] → 审阅项写进 coding-standards，并在三个修复 change 的收尾验证中强制运行；CI 接入留待 change 3 的 smoke 门禁一并处理。

## Migration Plan

无数据迁移。新增文件与文档；回滚即删除本 change 目录与注册表、测试、审阅项。

## Open Questions

无。指标阈值与样本量等参数由各修复 change 定义，本契约只要求「登记 + 可溯源」。
