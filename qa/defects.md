# Defects — Batch 1

> 被测提交：`998bb043fca133dbdc61cfa09f7fddd43e1d7508`
> 说明：Batch 1 验收范围内没有失败的验收用例（API 24/24、Playwright 8/8）。以下为 QA 过程中发现的**非阻断**问题；按任务要求只记录，不修产品代码。
>
> 首次 Playwright 运行有 1 条失败，原因是 QA 选择器未考虑项目 `trailingSlash: true`（真实 href 为 `/ai-ops/runtime/`、`/ai-ops/quality/?...`）。这是测试代码问题，已在 QA 侧修正，**不是产品缺陷**，不计入下表。

## D-01 — VIEWER 仍可读取评测集用例原文

| 项 | 内容 |
|---|---|
| 严重度 | P1（隐私/权限），但**明确延后到 Batch 4**，不计入 Batch 1 阻断 |
| 来源 | `handoff/batch-1.md` 已知限制 #2；`118` §8.1 #1 “Eval 数据集/结果的原文留给 Batch 4” |
| 位置 | `apps/api/src/admin/ai-eval/ai-eval.controller.ts`（`GET datasets/:id`、`GET runs/:id` 的 `@Roles` 含 VIEWER）；`ai-eval-dataset.service.ts` `getDataset`/`getRun` 未脱敏 |
| 影响 | VIEWER 可通过接口读取评测用例的 `question/answer`、运行结果的 `actualAnswer`，与 118 P0-1 的“VIEWER 去原文”目标不一致 |

**复现**（QA 库，已清理探针数据）：

```text
# ADMIN 创建评测集并加一条用例
POST /api/v1/admin/ai-eval/datasets            -> 200  {id: cmwpc0ebg...}
POST /api/v1/admin/ai-eval/datasets/<id>/cases -> 200

# VIEWER 读取详情
GET  /api/v1/admin/ai-eval/datasets/<id>       -> 200
data.cases[0] = {
  "question": "qa_eval_question_secret",
  "answer":   "qa_eval_answer_secret",
  ...
}
```

**期望**：VIEWER 的 eval 数据集/结果读接口应脱敏（或不对 VIEWER 开放）。
**实际**：原文完整返回。
**证据**：本次 QA 终端输出（dataset id `cmwpc0ebg0008w7l9cbj7o7oc`）；探针数据已通过 `DELETE FROM ai_eval_datasets WHERE name LIKE 'qa\_%'` 清理，QA 种子清理逻辑也已补上该表。
**建议**：按 118 计划在 Batch 4 处理；若在 Batch 1 合并前要求零原文暴露，需提前修复。

## D-02 — EDITOR 能看到工程导航，但 Traces 等接口对 EDITOR 返回 403

| 项 | 内容 |
|---|---|
| 严重度 | P2（既有问题，未由本批扩大；UI/API 权限不一致） |
| 来源 | `handoff/batch-1.md` 已知限制 #3 |
| 位置 | `apps/admin-next/src/routes/index.ts:193,200`（`hiddenForRoles: ['VIEWER']`，EDITOR 不隐藏）；`apps/api/src/admin/ai-traces/ai-traces.controller.ts`（`@Roles(SUPER_ADMIN, ADMIN, VIEWER)`，不含 EDITOR） |
| 影响 | EDITOR 在侧边栏看到「链路追踪」等入口，点进去调用 API 得到 403，页面显示加载失败 |

**复现**：

```text
# EDITOR JWT
GET /api/v1/admin/ai-traces -> 403

# 路由配置：工程组仅对 VIEWER 隐藏
routes/index.ts:193  hiddenForRoles: ['VIEWER']
routes/index.ts:200  hiddenForRoles: ['VIEWER']   # 其余工程路由同样只有 VIEWER
```

**期望**：导航可见性与接口可访问性一致（要么 EDITOR 可见且可读，要么对 EDITOR 也隐藏）。
**实际**：导航可见、接口 403。
**证据**：上条 curl 与源码行号。
**建议**：Batch 2/4 统一各角色的工程页权限；本批只要求 VIEWER，故不阻断。

## D-03 — VIEWER 首页「快速入口」仍展示工程页链接

| 项 | 内容 |
|---|---|
| 严重度 | P2（一致性；118 #1 只要求 Sidebar 隐藏，故不阻断） |
| 位置 | `apps/admin-next/src/app/(dashboard)/ai-ops/page.tsx`「快速入口」区块（约 536–564 行），链接未按角色过滤 |
| 影响 | Sidebar 已对 VIEWER 隐藏工程组，但首页仍提供 `AI Runtime / 流程版本 / 用量与成本 / 客户记忆` 入口，隐藏只是单点；VIEWER 可直接进入只读工程页 |
| 期望**（产品决策）** | 若目标是“VIEWER 看不到工程面”，快速入口也应过滤；若允许直接访问，则应显式说明“Sidebar 隐藏不等于权限边界” |
| 实际 | VIEWER 渲染的 SSR HTML 含工程链接 |

**复现**：

```text
$ curl -H "Cookie: auth_token=<VIEWER JWT>" http://127.0.0.1:4101/ai-ops/ \
    | grep -o 'href="/ai-ops/\(runtime\|flows\|usage\|memory\)[^"]*"' | sort -u
href="/ai-ops/flows/"
href="/ai-ops/memory/"
href="/ai-ops/runtime/"
href="/ai-ops/usage/"
```

**证据**：上述 SSR 输出；页面源码中该区块无角色条件。
**建议**：与产品确认“隐藏导航”和“禁止访问”的边界；本批验收标准只写了 Sidebar，因此不阻断。

---

## 附：非缺陷但需注意

- `apps/api/src/main.ts` 启动日志写 `Health → /api/health`，真实健康路由为 `/api/v1/health`（`/api/health` 返回 404）。仅影响运维脚本提示，与本批无关，未单列缺陷。
