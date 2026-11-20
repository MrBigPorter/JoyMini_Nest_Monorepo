# Handoff — Batch 2

> 依据：`docs/AI-joymini/120` §7 Batch 2；`118` §8.1 #4–5；`113` §9.1–9.2
> 状态：Dev 完成，待 QA 真实后端验证

## 任务

- 118 #4：待办/信号分轨；`updateTriage` 原子派生；回答正确 → `NO_ISSUE`；修一次一条跳条。
- 118 #5：feedback summary/list 加 `from/to`；首页用 UTC 今日；安全 summary 用今日；待处理 = actionable。

## 分支与提交

- branch: `feat/ai-ops-operator-console`
- commits:
  - `0f5f8b8b` feat(api): derive triage state on ingest and add today windows
  - `db52a60a` feat(admin): add signal queue, NO_ISSUE triage and today-scoped overview
- 冻结提交：QA 开始时 `git rev-parse HEAD`。

## 行为变化

### 后端

- 显式反馈：
  - `correct` → `NO_ISSUE` + `REVIEWED`，`failureKind=null`
  - `incorrect` → `MODEL_ERROR` + `OPEN` + `PENDING`
- 隐式反馈：
  - `reason=ai_error` → `SERVICE_ERROR` + `OPEN`
  - `reason=explicit_request` → `EXPECTED_TRANSFER` + `EXCLUDED`（不打扰运营）
  - `abandoned` → `USER_ABANDONED` + `OPEN`
  - `repeated_question` → `REPEATED_QUESTION` + `OPEN`
  - `transferred` 无原因 → `UNKNOWN` + `OPEN`
- `summary` 支持 `from/to`，返回 `pending`（actionable）与 `signals`。
- `list` 支持 `queue=TODO|SIGNAL`、`from/to`。
- `updateTriage`：
  - 只要给 `reviewStatus` 或 `resolution` 其中之一，两个字段一起写；
  - `verdict=correct` 时强制 `NO_ISSUE` 并清空 `failureKind`；
  - 只有判定（verdict/failureKind）变化才写 HUMAN `AiScore`；仅改备注不写。

### 前端

- 质量页新增「队列」筛选（全部 / 待办 / 系统信号）。
- KPI：待处理 → `?queue=TODO`；新增「系统信号」→ `?queue=SIGNAL`；其他 KPI 保持 failureKind/resolution。
- 「回答正确」写 `NO_ISSUE`，不再写 `CONFIRMED`。
- 一次一条：分诊后等待刷新，索引保持 0，不再跳过下一条。
- 首页 feedback/security summary 传 UTC 今日。
- Insights 三个链接带 `queue=SIGNAL&signal=...`。

## 自测证据

```text
API 全量：88 suites / 725 tests passed
API typecheck：exit 0
前端全量：55 files / 345 tests passed
前端 typecheck：exit 0
```

## 已知限制

1. 质量页 summary/list 未加日期选择器；队列本身是“全部未处理”，首页才是“今日”。
2. `pending` 是 actionable 定义，与旧 `reviewStatus=PENDING` 不同；旧页面若有其它入口需同步。
3. Eval 读接口原文仍留给 Batch 4（D-01）。
4. EDITOR 工程导航与接口不一致（D-02）未在本批扩大。
5. 历史数据回填（`verdict=correct` 修正为 `NO_ISSUE`、旧 `transferred→UNEXPECTED_TRANSFER` 降级）尚未执行；QA 只测新写入路径。

## QA 重点

- 新写入：correct/incorrect/ai_error/explicit_request/abandoned/repeated 的派生字段。
- summary：今天/昨天边界、pending 与 signals 计数、SQL 对账。
- list：`queue=TODO/SIGNAL` 与 `signal` 组合。
- triage：只给 reviewStatus、只给 resolution、correct、只改备注（不新增 score）。
- UI：队列筛选、系统信号 KPI、回答正确显示“无问题”、一次一条不跳条、首页今日计数。
