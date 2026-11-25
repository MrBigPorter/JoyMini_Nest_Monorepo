# AI 质量控制台审计（2026-11-25）

> 范围：`apps/admin-next` 路由 `/ai-ops/quality`（质量待办 / 回归测试 / 知识质量三个 tab，2722 行单文件）及其调用的 `/v1/admin/ai-feedback`、`/v1/admin/ai-eval`、`/v1/admin/rag` 接口。
> 方法：逐行通读 + 后端接口溯源 + 单测/类型检查/E2E 实跑（非仅静态推断）。
> 结论先行：**读路径已可用；写与执行链路未达到生产能力，页面今天不能直接交给运营日常使用。**

---

## 0. 验证现状（实跑证据）

| 检查 | 结果 |
|---|---|
| `tsc --noEmit`（admin-next） | ✅ 通过 |
| 单测 `AiQuality.test.tsx` + `ai-ops-quality-filters.test.ts` | ✅ 46/46 通过 |
| E2E `ai-ops-smoke` · quality 用例 | ❌ 2 条中 1 条失败：断言 `分诊归因` 在 55b0380c 已从页面删除，测试未同步 |
| E2E 是否进 CI | ❌ `ai-ops-smoke` 是 opt-in project，CI 默认只跑 `src/__e2e__` + chromium，红了没人知道 |
| OpenSpec 契约 | ⚠️ `openspec/specs/admin-ai/quality-loop/spec.md` 仅 43 行 4 条 Requirement，实现远超契约 |

结论：**验证信号是断的** —— 单测很密，但唯一页面级 E2E 长期红灯且不在门禁里。

---

## 1. 阻断项（上生产前必须修）

### B1. 评测启动无并发保护，双击即重复烧钱

[ai-eval-dataset.service.ts:403-427](../../apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts#L403-L427)：`findFirst(RUNNING)` 与 `create()` 之间无事务、无 advisory lock，schema 也没有 `(dataset_id) WHERE status='RUNNING'` 的部分唯一索引。前端 [page.tsx:1755-1773](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L1755-L1773) 的启动按钮无 in-flight 禁用。

两个请求同时通过检查 → 建两条 run → 各投递一个 job（jobId 不同，BullMQ 去重无效）→ 两次真实调用客服 + judge 模型。前端双击即可复现。

### B2. stale 清扫把「正在跑」误判为失败，长任务必死

[ai-eval-dataset.service.ts:327-368](../../apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts#L327-L368)：`recoverStaleRuns` 按 `startedAt < now-30min` 直接置 FAILED，并在 `listDatasets`/`getDataset`/`getRun` 每次读取时执行。但执行侧**从不更新 `startedAt` 或心跳**（全库 `grep heartbeat` 0 命中）。

后果：129 条 LIVE 用例每条 10-20s，超过 30 分钟；页面每 3 秒轮询 `getRun`，第 31 分钟由轮询自己把 run 改成 FAILED，worker 下一条看到非 RUNNING 直接退出。排队中的 run 同样会被任何打开页面的管理员"扫死"。

### B3. judge 解析失败被记为「回答错误」，污染质量指标

[ai-eval-judge.service.ts:224-235](../../apps/api/src/admin/ai-eval/ai-eval-judge.service.ts#L224-L235)：JSON 解析失败返回 `verdict:'unsolved', score:0, reason:'judge_parse_failed'`；内部 run 的结果不写 `judgeErrorKind`（该字段只有 EXTERNAL harness 路径写入），`buildSummary` 也没有 `judgeErrorRate`。

判官坏掉 → 通过率凭空下跌 → 控制台无法区分"模型答错"与"判官坏了" → 判官失败率门槛形同虚设。

### B4. 403 被 HTTP 层静默吞掉，失败显示为成功

[api/http.ts:404-408](../../apps/admin-next/src/api/http.ts#L404-L408)：`withRetry` 对 403 `return undefined as unknown as T`，GET 同样走这条路。

`AI_EVAL_ENABLED` 关闭（生产默认关闭）时打开回归测试页：知识库回归卡只有标题、无错误；`addCases`/`updateCase`/`deleteCase` 返回成功提示但一条没写；`createDataset`/`startRun` 因 `created.id` 为 undefined 直接抛 JS 异常。**运营无法信任任何成功提示。**

### B5. 质检主流程有三处硬伤

[page.tsx](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx)：

1. **「跳过」无效、提交回队首**（`:662`）：`advanceReview` 固定 `setReviewIndex(0)`，注释却写"索引保持不动"。在第一条点跳过永远不动；从第 N 条提交后回到第 1 条，之前跳过的全部重来。
2. **归因被默认值覆盖**（`:330`、`:678-684`）：本地 `failureKind` 初始 `'UNKNOWN'`，不读 URL 的 `failureKindFilter`，也不从 `current.failureKind` 初始化，切条目后不重置。按归因筛出 MODEL_ERROR 再进质检直接确认 → 真实归因被写成 UNKNOWN，汇总计数漂移。
3. **每次分诊强制弹备注 + 可重复提交**（`:482`、`:739-744`）：`window.prompt` 阻塞键盘流；取消返回 `null` 仍以 `undefined` 继续提交；`triage` 无 in-flight 状态，Enter 连按或双击会对同一条 PATCH 两次。

### B6. 「加入回归」默认命中只读数据集，且按字符串回查用例

- [page.tsx:581](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L581)：默认选 `datasetList[0]`，而列表里混着 `e2e:` 前缀的只读 harness 数据集 → 默认点确认大概率报 `External harness datasets are read-only`。
- [page.tsx:608-635](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L608-L635)：`addCases` 后按 `question` 字符串匹配反查新建用例 id 再回链反馈。两人同时提交同名问题时可能关联到别人的用例；`addCases` 成功而回链失败时会留下孤儿用例，重试再写一条（后端 `addCases` 不幂等、无 `sourceFeedbackId` 唯一约束）。

---

## 2. 高概率问题（影响闭环，可排期）

| # | 问题 | 位置 |
|---|---|---|
| H1 | 分诊「读旧值→派生→写」非原子，并发可写出 `verdict=correct + resolution=EXCLUDED` 的矛盾行 | [ai-feedback.service.ts:510-586](../../apps/api/src/common/ai/ai-feedback.service.ts#L510-L586) |
| H2 | 认领无排他，任何 ADMIN 可静默覆盖负责人，且不记 reviewedBy | [ai-feedback.service.ts:574-577](../../apps/api/src/common/ai/ai-feedback.service.ts#L574-L577) |
| H3 | 反馈更新与 AiScore 写入非事务，失败只 warn → 指标漂移且不可重放 | [ai-feedback.service.ts:588-617](../../apps/api/src/common/ai/ai-feedback.service.ts#L588-L617) |
| H4 | `addCases` 无元素数/文本长度上限，10MB 请求原样落库 | [eval-dataset.dto.ts:81-86](../../apps/api/src/admin/ai-eval/dto/eval-dataset.dto.ts#L81-L86) |
| H5 | `getRun` 每 3s 返回全量 results（含长文本），无分页 | [ai-eval-dataset.service.ts:720-733](../../apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts#L720-L733) |
| H6 | `getDataset` / `getChunks` 无分页，大文档一次返回数十 MB | [ai-eval-dataset.service.ts:222-237](../../apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts#L222-L237)、[rag.service.ts:289-304](../../apps/api/src/admin/rag/rag.service.ts#L289-L304) |
| H7 | 反馈列表 N+1：每行 1-3 次 `findUnique`，pageSize=100 时 200-300 条 SQL | [ai-feedback.service.ts:386-452](../../apps/api/src/common/ai/ai-feedback.service.ts#L386-L452) |
| H8 | 日期筛选按 UTC 日界，页面按本地时间显示 → 中国区运营的"11-20"实际是本地 08:00–次日 08:00 | [page.tsx:404-405](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L404-L405)、[ai-feedback.service.ts:61-74](../../apps/api/src/common/ai/ai-feedback.service.ts#L61-L74) |
| H9 | 批量排除 20 条并发 PATCH，撞 60/min 全局限流 → 部分失败且只报数量 | [page.tsx:555-577](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L555-L577) |
| H10 | 评测页权限是另一套规则，`AI_EVAL_ENABLED` 完全未使用；VIEWER 能看到「创建评测集/导入用例」 | [page.tsx:1652](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L1652)、`:1819`、`:1837` |
| H11 | run 进入终态后不刷新数据集卡片与基线下拉，必须切走再切回 | [page.tsx:1682-1693](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L1682-L1693) |
| H12 | 分页在 `total` 缩水后出现空页，无自动回退 | [page.tsx:1377](../../apps/admin-next/src/app/(dashboard)/ai-ops/quality/page.tsx#L1377) |
| H13 | 单条判分失败（重试后）让整次 run FAILED，已完成的 49 条无法续跑 | [ai-eval-judge.service.ts:242-253](../../apps/api/src/admin/ai-eval/ai-eval-judge.service.ts#L242-L253) |
| H14 | LIVE 用例 AI 失败计为 unsolved，与真实答错混算 | [ai-eval-dataset.service.ts:1298-1319](../../apps/api/src/admin/ai-eval/ai-eval-dataset.service.ts#L1298-L1319) |

---

## 3. 已具备生产能力的部分

- **反馈读路径**：服务端分页 `pageSize ≤ 100`、`note ≤ 500`，VIEWER 字段脱敏（question/answer 置 null），写接口 `@Roles(SUPER_ADMIN, ADMIN)`，前端隐藏不是唯一防线。
- **RAG 检索**：`topK ≤ 20`；`debug=true` 只暴露各层 docIds/计数/重排分数与 300 字预览，**不泄露 embedding、prompt 或 SQL**；依赖失败可降级（vector/Meili/reranker 逐个 catch）。
- **知识质量统计**：单次 `findMany` 7 个标量字段后内存聚合，无 N+1。
- **KB 回归状态**：纯 Prisma 读语料指纹，**无 docker exec / 本地文件系统依赖**，多实例成立。
- **取消评测**：条件 `updateMany({status:'RUNNING'})` + worker 每条用例前读 DB，跨实例取消成立（正在进行的单次 LLM 调用不可打断）。
- **案例级权限**：`updateCase/deleteCase` 校验 `case.datasetId === datasetId`，未发现真实 IDOR。

---

## 4. 契约与验证缺口

1. **契约落后**：`admin-ai/quality-loop` 只规定「可分诊 / 可批量跑分 / Prompt 真测 / 失败可见」四条；批量排除、认领、处理状态机、加入回归、KB 回归门禁、发布证据等大量已上线行为没有 Requirement。
2. **E2E 红灯且不在门禁**：`ai-ops-smoke` 需手动 `--project` 启动，CI 不跑；`分诊归因` 断言自 55b0380c 起失效。
3. **测试盲区**：权限模块整体被 mock，无「VIEWER 打开评测页」用例；「记录内联归因」测试手动选了 MODEL_ERROR，恰好绕过默认 UNKNOWN 的缺陷；无跳过/Enter 连按/total 缩水/403/只读数据集默认选中用例。
4. **`kb-regression-gate` 未收口**：tasks 4.5（CI workflow）、5.1（部署门禁）、7.1（QA 全量）、7.3（门禁演练）仍未勾选。

---

## 5. 修复优先级

**第一批（阻断，1-2 天）**
1. `advanceReview` 拆成 next / submit-keep-index；`failureKind` 从 `current.failureKind` 派生、切换条目重置；备注改内联可选；`triage` 加 in-flight 去重。
2. `withRetry` 不再吞 403；评测页统一 `canTriageFeedback(role) && evalEnabled`；失败态用 `AiErrorBanner`。
3. `startRun` 事务 + advisory lock（或部分唯一索引）；前端 `starting` 状态。
4. stale 清扫改按心跳，worker 每条用例更新 `heartbeatAt`。
5. judge 解析失败写 `judgeErrorKind`，不计入 unsolved，summary 输出 `judgeErrorRate`。
6. 「加入回归」过滤 `e2e:` 数据集；`addCases` 返回新建 id 或按 `sourceFeedbackId` 幂等回查。

**第二批（2-3 天）**
7. 分诊乐观锁 / claim 条件更新 + 审计；AiScore 入事务。
8. `addCases` DTO 上限；`getRun`/`getDataset`/`getChunks` 分页；反馈列表去 N+1。
9. 日期口径统一（本地日界或标注 UTC）。

**第三批（收口）**
10. 修 E2E、把 `ai-ops-smoke` 纳入 CI；补 OpenSpec Requirement；完成 `kb-regression-gate` 剩余 task。

---

## 6. 判定

- **功能完整度**：高。三 tab 覆盖反馈→评测→知识闭环，操作粒度到"认领/归因/进回归/发布证据"。
- **逻辑正确性**：中。读路径稳，写路径存在并发、事务、指标口径三类系统性问题。
- **可用性**：低。质检主流程的跳过/归因/备注三个缺陷直接破坏运营日常路径。
- **生产能力**：**读可用，写与执行不可用**。今天上线会让运营产生"已处理"的错觉，而数据没写对或没写进去。
