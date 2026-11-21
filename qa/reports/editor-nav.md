# QA Report — EDITOR Navigation Alignment

> 冻结提交 `1f1f193e`（含于 `d7bdced2`）
> 结论：**PASS（工程组隐藏）**；业务页对 EDITOR 的 403 为**既有残留**，非本次新阻塞

## 1. 测试对象

| 项 | 值 |
|---|---|
| 冻结提交 | `d7bdced2`（editor-nav `1f1f193e`） |
| 范围 | EDITOR 侧边栏 / 首页快速入口 / 异常卡不得出现「AI Operations · 工程」；ADMIN/SUPER 仍保留；业务页既有 403 残留 |
| 产品代码改动 | 无（QA 只扩展 `apps/admin-next/e2e-qa/navigation.spec.ts`） |

## 2. 命令

```bash
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/admin-next
QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/navigation.spec.ts
```

日志：`qa/logs/editor-nav-playwright.log`

## 3. 结果

| 用例 | 结果 |
|---|---|
| VIEWER：侧边栏隐藏工程组、首页无工程链接 | PASS |
| ADMIN：侧边栏与快速入口保留工程组 | PASS |
| SUPER_ADMIN：侧边栏与快速入口保留工程组 | PASS |
| EDITOR：侧边栏与首页隐藏工程组 | PASS |
| **合计** | **4 passed / 4** |

EDITOR 断言明细：

- 侧边栏仍显示「AI Operations · 今日」「AI Operations · 业务」，不显示「AI Operations · 工程」；
- `runtime / flows / usage / memory / security / context / traces / analysis` 在侧边栏链接数为 0；
- 首页整页无 `runtime/flows/usage/memory/security` 工程 href；
- 「快速入口」恰好 3 个链接：`quality / support / insights`，各 1 个。

代码依据：`apps/admin-next/src/routes/index.ts` 的 `ENGINEERING_HIDDEN_ROLES = ['VIEWER','EDITOR']`。

## 4. 残留：业务页对 EDITOR 仍 403（既有，非新阻塞）

EDITOR 的侧边栏按本轮要求保留了「业务」组，但业务页依赖的接口仍只允许 ADMIN/SUPER，因此页面会显示加载失败。该状态在 D-02 时代已存在；D-02/本轮只修「工程组隐藏」，没有扩大或新增 403。

实测（EDITOR JWT，`qa/logs/editor-business-403.log`）：

| 页面 | 依赖接口 | HTTP |
|---|---|---|
| 今日运营 | `GET /v1/admin/queues` | 403 |
| 今日运营 | `GET /v1/admin/ai-usage/summary` | 403 |
| 今日运营 | `GET /v1/admin/ai-security/summary` | 403 |
| 质量 | `GET /v1/admin/ai-feedback/summary` | 403 |
| 质量 | `GET /v1/admin/rag/documents/quality-stats` | 403 |
| 转人工 | `GET /v1/admin/chat/sla/queue` | 403 |
| 运营洞察 | `GET /v1/admin/ai-insights/overview` | 403 |
| 评测 | `GET /v1/admin/ai-eval/datasets` | 403 |
| 客服工作台 | `GET /v1/admin/chat/conversations` | 200 |

**判定**：这是 UI 可见性与 API 角色矩阵不一致的既有问题（与 D-02 同类、范围不同），**不是本轮改动引入的新阻塞**；本轮「工程组对齐」的验收仍为 PASS。已在 `qa/defects.md` 记为 D-ED-01（P2，OPEN，仅记录不修）。
