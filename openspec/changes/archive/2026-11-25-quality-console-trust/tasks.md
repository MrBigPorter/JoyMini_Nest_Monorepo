# Tasks

## 1. 信任层与权限

- [x] 1.1 改造 `apps/admin-next/src/api/http.ts`：`withRetry` 对 403 抛 `ForbiddenError`，`handleHttpError` 返回可区分错误；同步检查 `applicationApi.pendingCount` 等依赖旧 `undefined` 的调用方；验证：grep 不再出现 `return undefined as unknown as T`，vitest 403 用例显示错误而非成功 [Req: 管理端页面必须如实呈现失败、禁用与未知]
- [x] 1.2 页面引入统一 `RenderState`（loading/disabled/error/empty/ready），KPI、计数、summary 字段的空值渲染「未知/未检查」；验证：vitest 覆盖请求失败与字段缺失，页面不出现 0 冒充未知 [Req: 管理端页面必须如实呈现失败、禁用与未知]
- [x] 1.3 写入口统一由「有权限且 `AI_EVAL_ENABLED` 开启」双重控制；关闭或无权时不渲染创建评测集、导入用例、启动运行；验证：vitest 以 VIEWER 与开关关闭两种状态断言入口不存在且无假成功 [Req: 管理端页面必须如实呈现失败、禁用与未知]
- [x] 1.4 按角色设默认视图：运营→质量待办、质量负责人→回归测试（运行/基线/证据）、研发→链路面板与检索调试、管理者→趋势；验证：vitest 四种角色默认落点正确，切换视图后同一 run 数字不变 [Req: 角色视图必须与决策对应]
- [x] 1.5 清理质量页的 `?? 0` 与「暂无」误用（KPI、`_count`、summary、知识统计），前端推断处加「推断」徽标；验证：`grep -n "?? 0" apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx` 无命中，vitest 覆盖推断徽标 [Req: 管理端页面必须如实呈现失败、禁用与未知]

## 2. 质检主流程

- [x] 2.1 拆分 `advanceReview`：跳过只移动游标，提交按原索引前进；归因初值取 `current.failureKind ?? 筛选值`，切条重置；验证：vitest 跳过第一条后到第二条、按归因筛选进入初值正确、切条后重置 [Req: 质检卡片必须可跳过且归因不得被默认值覆盖]
- [x] 2.2 备注改内联可选输入，提交用 `submittingIds` 去重；验证：vitest 双击与连按 Enter 只发一次请求，取消备注不提交 [Req: 分诊提交必须防重复且备注可选]
- [x] 2.3 认领与处理完成在列表和卡片上分开呈现，「已认领」不再显示为「待处理」；验证：vitest 已认领行显示独立徽标，筛选计数正确 [Req: 分诊提交必须防重复且备注可选]
- [x] 2.4 列表请求返回后若当前页越界，自动回退到最后一页并重取一次；验证：vitest 处理完当前页最后一条后自动回退，总数归零显示空状态 [Req: 分页必须在总量缩水后回退]
- [x] 2.5 「加入回归」过滤 `e2e:` 只读数据集；弹窗文案与实际行为一致（期望必填则删除「稍后可补充」）；验证：vitest 默认不选中只读数据集，文案与校验一致 [Req: 管理端页面必须如实呈现失败、禁用与未知]

## 3. 服务端接口与证据

- [x] 3.1 新增 `POST /v1/admin/ai-feedback/:id/regression-case`：事务内 `pg_advisory_xact_lock(hashtext(feedbackId))`，已有则幂等返回，创建用例并回写 `linkedEvalCaseId`；手写迁移建 `ai_eval_cases(source_feedback_id) WHERE source_feedback_id IS NOT NULL` 部分唯一索引（迁移前去重并记录数量）；验证：jest 同反馈并发两次返回同一用例，回链失败整体回滚 [Req: 管理端页面必须如实呈现失败、禁用与未知]
- [x] 3.2 新增 `PATCH /v1/admin/ai-feedback/batch-exclude`：数组 ≤50，逐条校验并返回 `{ succeeded, skipped: [{ id, reason }] }`，判官失败记录跳过并说明；验证：jest 20 条含 2 条不合法逐条返回原因、>50 返回 400、含 `MODEL_ERROR` 被跳过 [Req: 批量排除必须逐条反馈结果]
- [x] 3.3 前端「加入回归」与「批量排除」改调 3.1/3.2 的新接口，删除字符串反查与并发 PATCH；验证：grep 无按 `question` 反查用例的代码，vitest 两处调用新接口 [Req: 批量排除必须逐条反馈结果]
- [x] 3.4 质检卡片证据面板：按 `messageId` 精确匹配展示失败 span 摘要；回退会话最新时标「近似」；trace 为空标「证据已过期」；前端推断归因加「推断」徽标；验证：vitest 三态各一例，无 trace 时不展示其他链路 [Req: 质检证据必须可追溯]
- [x] 3.5 补 `ai-ops-smoke`：新增 `/v1/admin/ai-ops/features` mock 与三例（跳过前移、403 禁用态、分页回退）；验证：`cd apps/admin-next && ../../node_modules/.bin/playwright test --project=ai-ops-smoke` 全绿 [Req: 管理端页面必须如实呈现失败、禁用与未知]

## 4. 集成验证

- [x] 4.1 全量验证：`openspec validate "quality-console-trust" --strict`、两端 tsc、api jest（ai-feedback）、admin vitest、`ai-ops-smoke`；验证：全部命令以 0 退出 [Req: 管理端页面必须如实呈现失败、禁用与未知]
- [ ] 4.2 手工演练：`AI_EVAL_ENABLED=false` 打开页面，确认无写入口、无假成功、未知不显示 0；恢复开关后确认入口出现；验证：两项均符合预期 [Req: 管理端页面必须如实呈现失败、禁用与未知]
  - 未完成原因（2026-11-25 本地核实）：features 与写接口的门都是 `AI_EVAL_ENABLED === 'true' || NODE_ENV === 'development'`，本地后端固定 `NODE_ENV=development`，设 `AI_EVAL_ENABLED=false` 不会生效，禁用态无法在本地呈现。该状态由 vitest 开关关闭用例与 `ai-ops-smoke` 覆盖。反馈分诊的禁用态（`AI_FEEDBACK_UI_ENABLED=false`）已在真实后端上人工确认：只读提示、无写入口、无假成功。

## 遗留问题（归档后另起变更处理，来自 2026-11-25 质量待办页人工走查）

- 默认视图：`/ai-ops/quality/` 默认不带 `queue`，打开是全部 217 条；tab 叫「质量待办」却先展示全量。建议默认 `queue=TODO`，全量作为可选项（仅动前端默认筛选与跳转）。
- KPI 口径混叠：六张卡分别按 `resolution`（待处理/已进回归）、队列（系统信号）、`failureKind`（模型答错/服务故障/误转）计算，互不独立且合计 ≠ 总数；最大类别「归因未知」（112 条）没有卡片。
- 「待处理」同词不同义：KPI 指可行动队列（3 条服务故障），表格「处理结果」列指 `resolution=OPEN`（113 行）。需要区分标签（如「待办队列」与「未结案」）。
- 诊断列噪声：`无链路` 徽标对 56% 的行（121/217）恒亮，失去判断价值，且与证据面板「证据已过期」语义重复。
- 诊断误报：`中问英答` 会把静态兜底话术（`ai-failure-handler.ts` 的 offline_handoff）判成模型语言问题，需先排除模板回复再判定。
- 筛选与列不匹配：有「分诊状态」筛选（`reviewStatus`），表格却只展示 `resolution`，筛完无处核对。
- 只读态表格空列多：备注、负责人等列在该状态下全空，占宽不提供信息。
- 时间格式：`toLocaleString()` 在中文界面渲染成 `11/24/2026, 9:43:08 PM`，需统一格式。
- 知识质量分数不重算（2026-11-25 核实）：11/21 提交 `e4eff5ab` 给截断检查加了表格行/列表项/代码块/标题豁免，但 11/11 上传的 Account Guide、Group Buying Guide、Order Management 仍是 `quality_score=75` + `truncation`——它们的结尾分别是列表项和表格行，按现行规则应为 100。`待复核 3` 是过期数据，且没有重算入口。修法：上传新版本时重算，或提供批量重新体检动作。
- 知识质量页其余空洞：`parse_checks` 从未写入（27 篇全为「解析未采集」，无法定位具体失败项）；有效性（检索命中/引用正确率）没有采集链路，分档只反映解析层；「待复核」没有复核动作入口，只能看新旧分块、无法落结论。

## Workflow follow-up

- 实现并验证通过后运行 `openspec archive "quality-console-trust"`。
- 归档前确认 `ai-quality-loop-contract` 已归档。
