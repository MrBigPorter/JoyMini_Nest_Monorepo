# Lighthouse Runner (Admin Next)

This runner automates the 5-page Lighthouse audit described in `read/PERFORMANCE_LIGHTHOUSE_CN.md`.

## 学习目标（看懂这些就基本掌握）

读 `scripts/lighthouse/run.mjs` 时，先按这 5 个问题理解：

1. **配置怎么进来**：`LIGHTHOUSE_*` 环境变量 + 默认值
2. **鉴权怎么做**：`LIGHTHOUSE_COOKIE` > 登录 API > 匿名模式
3. **一次采集做了什么**：跑 Lighthouse、落地 `run-*.json/html`
4. **为什么取中位数**：避免冷启动或偶发抖动影响结论
5. **什么时候失败退出**：`--strict` 下任一页面不达标返回非 0

如果这 5 点都能复述，脚本核心逻辑就掌握了。

## What It Does

- Targets 5 pages: `/login`, `/`, `/analytics`, `/finance`, `/orders`
- Runs each page N times (`LIGHTHOUSE_RUNS_PER_PAGE`, default `3`)
- Stores raw reports (`json` + `html`) per run
- Writes median summary to `summary.json` and `summary.md`
- Supports strict threshold gating via `--strict`

## Quick Start

From monorepo root:

```bash
yarn perf:lighthouse
```

Strict mode (non-zero exit if any page fails thresholds):

```bash
yarn perf:lighthouse:strict
```

指定单次 run 最大超时时间（秒，默认 180）：

```bash
LIGHTHOUSE_MAX_SECONDS_PER_RUN=120 yarn perf:lighthouse
```

Override target URL:

```bash
LIGHTHOUSE_BASE_URL="https://admin.joyminis.com" yarn perf:lighthouse
```

## Auth Options

The runner supports three auth methods (priority order):

1. `LIGHTHOUSE_COOKIE` (direct cookie header)
2. Login API with credentials:
   - `LIGHTHOUSE_ADMIN_USERNAME` + `LIGHTHOUSE_ADMIN_PASSWORD`
   - fallback to `E2E_ADMIN_USERNAME` + `E2E_ADMIN_PASSWORD`
3. Anonymous mode (only public pages)

If your login payload is not `{ account, password }`, set:

```bash
LIGHTHOUSE_LOGIN_PAYLOAD_JSON='{"username":"admin","password":"***"}'
```

> 注意：默认 payload 是 `{ username, password }`。

## Output

Reports are saved under:

```text
apps/admin-next/reports/lighthouse/<timestamp>/
```

Files:

- `<page>/run-1.json`, `<page>/run-1.html`, ...
- `summary.json` (machine-readable)
- `summary.md` (table for docs)

## 指标含义 -> 常见问题

- `LCP` 高：首屏最大元素出现晚，常见是首屏请求慢、主内容依赖 JS/hydration、图片过大
- `FCP` 高：首个可见内容出现慢，常见是 HTML 首包慢、关键 CSS/字体阻塞
- `TBT` 高：主线程阻塞重，常见是大 bundle、重计算、图表库首屏同步加载
- `CLS` 高：布局跳动，常见是图片/卡片无固定尺寸、异步内容插入占位不足

建议先看 `summary.json` 的中位数，再看各页面 `run-*.html` 定位具体元素。

## 电脑卡住时，脚本怎么停

`run.mjs` 支持两段式停止：

- 第一次 `Ctrl + C`：**优雅停止**（当前 run 完成后停止，尽量写出已完成页面的 summary）
- 第二次 `Ctrl + C`：**强制退出**（立即结束，退出码 130）

如果你担心某次 run 卡太久，建议提前设置：

```bash
LIGHTHOUSE_MAX_SECONDS_PER_RUN=120 yarn perf:lighthouse
```

再配合降低运行次数减少机器压力：

```bash
LIGHTHOUSE_RUNS_PER_PAGE=1 yarn perf:lighthouse
```

## 推荐阅读顺序

1. `apps/admin-next/scripts/lighthouse/run.mjs`（带步骤注释，先看执行流程）
2. `apps/admin-next/scripts/lighthouse/README.md`（你正在看的操作说明）
3. `read/PERFORMANCE_LIGHTHOUSE_CN.md`（验收标准与决策树）
