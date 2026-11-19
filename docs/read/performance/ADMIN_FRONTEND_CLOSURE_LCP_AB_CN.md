# admin-frontend-closure 6.2 — 首屏 LCP A/B 实测

> 日期：2026-11-19
> 变更：`openspec/changes/admin-frontend-closure`（任务 6.2）
> 原始报告：`apps/admin-next/reports/performance-ab/20261119-lcp-ab/`（gitignored）

## 1. 结论

三个改动页面（`/users/`、`/orders/`、`/finance/`）的 LCP 均**未出现显著上升**，判定 **PASS**：

| 页面 | baseline median | candidate median | Δ | Δ 95% CI | 判定 |
|---|---:|---:|---:|---|---|
| `/users/` | 157ms | 155ms | −2ms（−1.2%） | −13 … +7ms | PASS |
| `/orders/` | 130ms | 135ms | +5ms（+3.8%） | −2 … +11ms | PASS |
| `/finance/` | 167ms | 164ms | −2ms（−1.3%） | −6 … +7ms | PASS |
| `/`（对照） | 129ms | 133ms | +3ms（+2.5%） | −2 … +21ms | PASS |

判定规则（每页独立）：

1. `Δ ≤ max(100ms, 10%)`
2. Δ 的 bootstrap 95% CI 上界 `≤ max(150ms, 15%)`
3. 候选 median LCP `< 1500ms`

## 2. 环境与来源

| 项 | 值 |
|---|---|
| 基线 | `git worktree` detached `a973942a`（HEAD，未含本次改动） |
| 候选 | 当前工作区 `feat/enterprise-readiness`（未提交改动） |
| 候选 diff 指纹 | `git diff \| shasum -a 256` = `3154787…a09bee2` |
| Node | v24.14.1 |
| Lighthouse | 12.8.2 |
| Chrome | 157.0.8103.79（`/Applications/Google Chrome.app`） |
| Next / Tailwind | 两边均为 15.2.4 / 4.2.1（worktree 同时软链根、app、packages 的 `node_modules`） |
| 构建期 API | `NEXT_PUBLIC_API_BASE_URL=http://localhost/api` |
| 运行期 API | `INTERNAL_API_URL=http://localhost/api` |
| 服务端口 | candidate `:4001`，baseline `:4002`（同时运行） |
| 电源 | AC 外接 |

后端为本地 Docker Compose（`lucky-backend-dev` + `lucky-db` + `lucky-nginx-dev`），测量期间未写入数据。

## 3. 方法

- 两套都是生产构建（`next build` + `next start`），构建参数一致。
- 每个样本使用**独立 Chrome**：预置 `auth_token` cookie 与 `localStorage.auth_token`，随后清空 HTTP 缓存，再跑 Lighthouse，保证是冷缓存首屏。
  - 只带 cookie 不够：middleware 放行后，客户端 auth store 仍要求 localStorage，否则 hydration 后会跳 `/login`。
- 每页每版本 3 次 × 5 轮 = 15 个样本；轮次内 A/B 交替（第 1 轮 A→B，第 2 轮 B→A……），抵消机器漂移。
- 每次 Lighthouse 前先带 cookie `curl` 预热服务端路由；样本间隔 2s。
- 页面顺序固定：`/` → `/users/` → `/orders/` → `/finance/`。
- `/login` 未纳入：登录态下 middleware 会 302 到 `/`，测到的是首页而非登录页。
- 统计：median + IQR；Δ 的 95% CI 用固定种子（42）bootstrap 10,000 次。

## 4. 样本有效性

- 预期 15/15/页/版本；`/users/` 候选侧有 1 个样本的 `finalDisplayedUrl` 落在 `/`，按规则剔除，实际 14 个（仍 ≥ 9 的下限）。
- 其余样本 `finalDisplayedUrl` 均与目标页一致，无 `runtimeError`。
- 原始文件：`baseline/session-0N/<page>/run-N.report.json` 与 `candidate/...`；汇总见同目录 `comparison.json` / `comparison.md`。

## 5. 次要指标（median 变化）

| 页面 | FCP Δ | TBT Δ | CLS Δ | Perf score Δ |
|---|---:|---:|---:|---:|
| `/` | +2.8ms | 0 | 0 | 0 |
| `/finance/` | −0.6ms | 0 | 0 | 0 |
| `/orders/` | −2.1ms | 0 | 0 | 0 |
| `/users/` | +1.7ms | 0 | 0 | 0 |

## 6. 局限

- 本机无网络/CPU 节流，只用于**相对 A/B**，不能当作线上 SLO 绝对值。
- 只覆盖桌面 1365×940；移动端与真实网络不在本次范围。
- Lighthouse 的 LCP 是实验室指标，不等于真实用户 LCP。
- 本报告不替代 LHCI 对生产环境的持续监控。

## 7. 复现

```bash
# 1) 基线 worktree（软链根、app、packages 的 node_modules）
git worktree add --detach /Volumes/MySSD/work/JoyMini_Nest_Monorepo-baseline-a973942a a973942a

# 2) 两边构建（NEXT_PUBLIC_API_BASE_URL=http://localhost/api）
# 3) 两边 next start：candidate :4001 / baseline :4002

# 4) 采集
AB_TOKEN=<admin jwt> node apps/admin-next/scripts/lighthouse/measure-ab.mjs \
  --out reports/performance-ab/<run-id> --rounds 5 --runs 3

# 5) 分析
node apps/admin-next/scripts/lighthouse/summarize-ab.mjs \
  --dir reports/performance-ab/<run-id>
```
