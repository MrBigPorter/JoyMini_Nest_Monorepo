# Sentry 指标查看速查（Admin Next）

适用范围：`apps/admin-next`（Next.js 15 + Cloudflare Workers）

## 1) 先看是否有数据

进入 Sentry 项目后先设置过滤：

- `environment = production`（线上）
- 时间范围：`Last 15 minutes`

如果没有数据，先检查：

- `NEXT_PUBLIC_SENTRY_DSN` 是否已配置
- 最近是否有真实访问/操作
- 部署是否已经完成并生效

## 2) 看错误（Issues）

路径：`Sentry -> Issues`

重点看：

- `Unhandled`（未捕获异常）
- `New` 或 `Regressed`
- 影响用户数（`Users`）和事件次数（`Events`）

进入某条 Issue 后：

- 看 `Stack Trace` 定位文件与函数
- 看 `Tags`（环境、浏览器、路由）
- 看 `Breadcrumbs` 还原用户操作路径

## 3) 看请求链路耗时（Transactions / Spans）

路径：`Sentry -> Performance -> Transactions`

重点看：

- `p95` / `p99` 延迟
- 慢事务的 `span` 分布（前端请求、SSR fetch、路由跳转）
- 同一路由是否在某次发布后变慢（Regression）

建议常用过滤：

- `transaction.op:pageload`（首屏加载）
- `transaction.op:navigation`（路由跳转）

## 4) 看 Profile（CPU 热点）

路径：`Sentry -> Performance -> Profiles`

适合排查：

- 前端主线程卡顿
- 某些页面交互时 CPU 飙高

注意：

- 当前线上是 Cloudflare Workers edge：
  - 浏览器 Profile：支持
  - Node.js CPU Profiling：不支持（edge 无 Node native profiler）

## 5) 建议先看的核心指标

- 错误率：`Issue` 新增/回归数量
- Web Vitals：`LCP`、`CLS`、`INP`（若已接入）
- 性能分位：`p95`、`p99`
- 慢接口/慢 span：Top N

## 6) 5 分钟验收流程（上线后）

1. 打开后台首页、列表页、客服页各操作一次
2. 到 `Issues` 看是否出现新错误
3. 到 `Transactions` 看 `pageload` 与 `navigation` 是否有数据
4. 到 `Profiles` 看是否有浏览器 profile 采样
5. 若异常升高，按 release 回滚或降采样

## 7) 常见误区

- 看到 Sentry 的 profiling 向导，不代表你的运行时一定支持 Node CPU profiling
- 没有 profile 不一定是坏了，可能是采样率较低或时间窗口太短
- 本地浏览器 Network 里看不到服务端上报是正常现象
