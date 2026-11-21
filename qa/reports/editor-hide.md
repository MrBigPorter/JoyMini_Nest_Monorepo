# QA Report — EDITOR Full AI Operations Hide

> 冻结提交 `3d4d3387`（EDITOR 全隐藏 `c7322b3c`）
> 结论：**PASS**（editor-hide 4/4 + navigation 4/4 = 8/8；D-ED-01 FIXED）

## 1. 测试对象

| 项 | 值 |
|---|---|
| 冻结提交 | `3d4d3387`（EDITOR 全隐藏 `c7322b3c`） |
| 范围 | EDITOR 侧边栏无任何 AI Operations（今日/业务/工程）；`/ai-ops` 直接访问仍渲染但快速入口为空；ADMIN/SUPER/VIEWER 不变；业务接口 403 残留 |
| 产品代码改动 | 无（QA 只改 `apps/admin-next/e2e-qa/**`） |

## 2. 命令

```bash
cd /Volumes/MySSD/work/JoyMini_Nest_Monorepo/apps/admin-next
QA_ADMIN_URL=http://127.0.0.1:4101 QA_API_URL=http://127.0.0.1:4102/api \
  ../../node_modules/.bin/playwright test --config=playwright.qa.config.ts \
  e2e-qa/editor-hide.spec.ts e2e-qa/navigation.spec.ts
```

日志：`qa/logs/editor-hide-playwright.log`

## 3. 结果

| 用例 | 结果 |
|---|---|
| EDITOR：侧边栏无 AI Operations 三组、无 `/ai-ops` 链接、快速入口 0 链接 | PASS |
| EDITOR：直接访问 quality/support/insights 仍渲染页面，导航仍无业务组 | PASS |
| ADMIN：三组导航与 8 个快速入口不变 | PASS |
| VIEWER：今日/业务可见、工程隐藏、快速入口 3 个 | PASS |
| navigation：VIEWER / ADMIN / SUPER_ADMIN / EDITOR 4 项 | PASS |
| **合计** | **8 passed / 8** |

### 3.1 EDITOR 断言

- `aside` 中「AI Operations · 今日」「AI Operations · 业务」「AI Operations · 工程」文本均为 0；
- `aside a[href^="/ai-ops"]` 为 0；
- 直接打开 `/ai-ops/` 仍显示「今日运营」标题（路由隐藏只影响导航），「快速入口」内 `<a>` 数量为 0；
- 直接打开 `/ai-ops/quality`、`/ai-ops/support`、`/ai-ops/insights` 页面标题仍渲染，但侧边栏无业务组入口。

代码依据：`apps/admin-next/src/routes/index.ts` 为 `/ai-ops`、`quality`、`support`、`insights` 增加 `hiddenForRoles: ['EDITOR']`；`ai-ops/page.tsx` 用 `aiOpsVisible` 同时过滤快速入口。

## 4. 业务接口 403 残留（预期，非新阻塞）

导航已全隐藏，但 EDITOR 直接调用业务接口仍 403（角色矩阵未变）。实测 `qa/logs/editor-business-403.log`：

| 接口 | HTTP |
|---|---|
| `ai-feedback/summary` | 403 |
| `ai-security/summary` | 403 |
| `chat/sla/queue` | 403 |
| `ai-insights/overview` | 403 |
| `queues` | 403 |
| `ai-usage/summary` | 403 |
| `rag/documents/quality-stats` | 403 |
| `ai-eval/datasets` | 403 |
| `chat/conversations` | 200 |

**判定**：保留 403 是 `c7322b3c` 的设计选择（EDITOR 为内容角色，业务读接口不含 EDITOR；导航隐藏避免“可见不可用”与 PII 暴露）。因此 D-ED-01 的 UI/API 不一致已消除，标记 **FIXED**。

## 5. 缺陷

D-ED-01 **FIXED**（`c7322b3c`）。本组无新缺陷。

## 6. 残留 / 未覆盖

- 直接 URL 仍可打开 `/ai-ops*` 页面；页面依赖的接口 403 会显示错误态。若要求“不可访问”而非“不可见”，需要服务端路由级拦截；本轮验收只要求导航隐藏。
- 未跑全量前端测试，只跑 editor-hide + navigation；提交内已有 Sidebar/routes/AiOpsOverview 单测。
