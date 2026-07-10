# Current Task — Flutter AI Chat SSE 集成

**目标**: 对接 Flutter 移动端与 SSE 流式接口（打字机 + Action Card + 转人工）
**参考**:

- [`65-Flutter-AI-Chat-SSE-Integration.md`](docs/AI-joymini/65-Flutter-AI-Chat-SSE-Integration.md) — 技术实现
- [`66-Flutter-AI-Chat-Enterprise-Spec.md`](docs/AI-joymini/66-Flutter-AI-Chat-Enterprise-Spec.md) — 企业级规格
- Flutter 项目: `/Users/porter/Developer/JoyMini_Flutter_App/`

---

## ✅ 已完成

### SSE 后端基础

- [`ai-customer.controller.ts`](apps/api/src/client/ai-customer/ai-customer.controller.ts) — SSE 端点 + 5 响应头
- [`ai-customer.service.ts`](apps/api/src/client/ai-customer/ai-customer.service.ts) — streamEvents + 4 种事件 (token/step/done/error)
- [`sse-rate-limiter.service.ts`](apps/api/src/client/ai-customer/sse-rate-limiter.service.ts) — 5 层 Redis 限流 + 熔断 + 超时
- [`chat-stream.dto.ts`](apps/api/src/client/ai-customer/dto/chat-stream.dto.ts) — DTO
- [`redis.service.ts`](apps/api/src/common/redis/redis.service.ts) — incr/decr/expire/setNx/eval/withTimeout
- [`nginx/conf.d/10-api.conf`](nginx/conf.d/10-api.conf) — SSE proxy_buffering off

### Score Gap Check

| `dto/chat-stream.dto.ts` | 新增 DTO |
| `ai-customer.module.ts` | 注册 SseRateLimiterService |

### Redis 企业级限流

| 层         | 限制                     | 技术                    |
| ---------- | ------------------------ | ----------------------- |
| Layer 1    | 每人 1 个连接            | Redis setNx + TTL 70s   |
| Layer 1.5  | 每 IP 5 个连接           | Redis incr + expire 60s |
| Layer 1.75 | 每设备 3 个连接          | Redis incr + expire 60s |
| Layer 2    | 全局 200 个连接          | Redis incr/decr         |
| Layer 3    | 令牌桶 6 个/每秒 1 个    | Redis Lua 脚本          |
| 熔断器     | 连续 3 次失败 → 熔断 30s | 内存变量                |
| 超时       | 2 秒超时降级             | withTimeout             |

### 新增文件

| 文件                          | 说明                     |
| ----------------------------- | ------------------------ |
| `sse-rate-limiter.service.ts` | 5 层 Redis 限流 + 熔断器 |
| `dto/chat-stream.dto.ts`      | SSE 请求 DTO             |

### 修改文件

| 文件                        | 改动                                         |
| --------------------------- | -------------------------------------------- |
| `redis.service.ts`          | 新增 incr/decr/expire/setNx/eval/withTimeout |
| `ai-customer.controller.ts` | 新增 chatStream + @RealIP + @CurrentDevice   |
| `ai-customer.service.ts`    | 新增 chatStream(streamEvents)                |
| `ai-customer.module.ts`     | 注册 SseRateLimiterService                   |
| `nginx/conf.d/10-api.conf`  | 新增 SSE location(proxy_buffering off)       |

### 文档

| 文件                                                | 说明                 |
| --------------------------------------------------- | -------------------- |
| `docs/coding-standards.md`                          | 9 维度企业级代码规范 |
| `docs/AI-joymini/63-Intent-Score-Gap-Check-Spec.md` | Score Gap Check spec |
| `docs/AI-joymini/64-SSE-Enterprise-Analysis.md`     | SSE 企业级分析       |

---

## 🐛 Bug 修复（2026-07-10 Code Review）

| #   | 问题                                                          | 修复文件                              | 状态 |
| --- | ------------------------------------------------------------- | ------------------------------------- | ---- |
| 1   | 熔断期间返回 `{ok:true}`，导致熔断形同虚设                    | `sse-rate-limiter.service.ts:86`      | ✅   |
| 2   | `release()` 不清理 IP/Device 计数器，导致计数漂移             | `sse-rate-limiter.service.ts:159-175` | ✅   |
| 3   | 全局计数器 `decr` 无下限检查，可能变负数                      | `sse-rate-limiter.service.ts:164-166` | ✅   |
| 4   | Controller 的 `res.on('close')` 未传 ip/deviceId 给 release() | `ai-customer.controller.ts:133`       | ✅   |

**验证**: `yarn workspace @lucky/api tsc --noEmit --pretty` → exit 0, 零错误

---

## ❌ 待办

| 优先级 | 功能     | 说明                        |
| ------ | -------- | --------------------------- |
| 🟡 P1  | 前端集成 | fetchEventSource + 事件解析 |
| 🟢 P2  | 可观测性 | Prometheus 指标             |
